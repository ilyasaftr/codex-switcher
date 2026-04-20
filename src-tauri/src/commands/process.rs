//! Process detection commands

use std::process::Command;

#[cfg(windows)]
use anyhow::Context;

#[cfg(windows)]
use std::collections::HashSet;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsCodexProcess {
    name: String,
    process_id: u32,
    parent_process_id: u32,
    #[serde(default)]
    command_line: String,
    #[serde(default)]
    main_window_title: String,
}

#[cfg(unix)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct UnixCodexProcess {
    pid: u32,
    parent_pid: u32,
    command: String,
    executable: String,
}

/// Information about running Codex processes
#[derive(Debug, Clone, serde::Serialize)]
pub struct CodexProcessInfo {
    /// Number of active Codex app instances
    pub count: usize,
    /// Number of ignored background/stale Codex-related processes
    pub background_count: usize,
    /// Whether switching is allowed (no active Codex app instances)
    pub can_switch: bool,
    /// Process IDs of active Codex app instances
    pub pids: Vec<u32>,
}

/// Check for running Codex processes
#[tauri::command]
pub async fn check_codex_processes() -> Result<CodexProcessInfo, String> {
    let (pids, bg_count) = detect_codex_processes().map_err(|e| e.to_string())?;
    let count = pids.len();

    Ok(CodexProcessInfo {
        count,
        background_count: bg_count,
        can_switch: count == 0,
        pids,
    })
}

pub(crate) fn find_active_codex_processes() -> anyhow::Result<Vec<u32>> {
    let (pids, _) = detect_codex_processes()?;
    Ok(pids)
}

pub(crate) fn kill_codex_processes(pids: &[u32]) -> anyhow::Result<()> {
    for pid in pids {
        #[cfg(unix)]
        {
            let output = Command::new("kill")
                .arg("-9")
                .arg(pid.to_string())
                .output()?;
            if !output.status.success() {
                anyhow::bail!(
                    "Failed to kill Codex process {pid}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        #[cfg(windows)]
        {
            let output = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output()?;
            if !output.status.success() {
                anyhow::bail!(
                    "Failed to kill Codex process {pid}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
    }

    Ok(())
}

pub(crate) fn terminate_codex_processes(pids: &[u32]) -> anyhow::Result<()> {
    for pid in pids {
        #[cfg(unix)]
        {
            let output = Command::new("kill")
                .arg("-15")
                .arg(pid.to_string())
                .output()?;
            if !output.status.success() {
                anyhow::bail!(
                    "Failed to terminate Codex process {pid}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
        }
        #[cfg(windows)]
        {
            let _ = pid;
        }
    }

    Ok(())
}

/// Find all running codex processes. Returns (active_pids, background_count)
fn detect_codex_processes() -> anyhow::Result<(Vec<u32>, usize)> {
    #[cfg(unix)]
    {
        // Include parent PID so helper subprocesses can be filtered without
        // counting them as separate active app instances.
        let output = Command::new("ps").args(["-eo", "pid,ppid,command"]).output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Ok(detect_unix_codex_processes_from_ps(
                &stdout,
                std::process::id(),
            ));
        }

        return Ok((Vec::new(), 0));
    }

    #[cfg(windows)]
    {
        return detect_windows_codex_processes();
    }

    #[allow(unreachable_code)]
    Ok((Vec::new(), 0))
}

#[cfg(windows)]
fn detect_windows_codex_processes() -> anyhow::Result<(Vec<u32>, usize)> {
    // tasklist counts every Electron helper (`--type=gpu-process`, crashpad, renderer, etc.),
    // which inflates the badge and incorrectly blocks switching. Use PowerShell so we can inspect
    // the command line and only count live top-level app instances.
    const POWERSHELL_SCRIPT: &str = r#"
$windowTitles = @{}
Get-Process -Name Codex -ErrorAction SilentlyContinue | ForEach-Object {
  $windowTitles[[uint32]$_.Id] = $_.MainWindowTitle
}

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -ieq 'Codex.exe' -or $_.Name -ieq 'codex.exe' } |
  ForEach-Object {
    [PSCustomObject]@{
      Name = $_.Name
      ProcessId = [uint32]$_.ProcessId
      ParentProcessId = [uint32]$_.ParentProcessId
      CommandLine = if ($_.CommandLine) { $_.CommandLine } else { '' }
      MainWindowTitle = if ($windowTitles.ContainsKey([uint32]$_.ProcessId)) {
        [string]$windowTitles[[uint32]$_.ProcessId]
      } else {
        ''
      }
    }
  } |
  ConvertTo-Json -Compress
"#;

    let output = Command::new("powershell.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT])
        .output()
        .context("failed to query Windows process list")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("PowerShell process query failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let processes = parse_windows_codex_processes(&stdout)?;

    let mut active_pids = Vec::new();
    let mut ignored_count = 0;

    for process in processes.iter().filter(|process| is_windows_codex_root_process(process)) {
        let command = process.command_line.to_ascii_lowercase();
        if is_ide_plugin_process(&command) {
            ignored_count += 1;
            continue;
        }

        let has_window = !process.main_window_title.trim().is_empty();
        let has_renderer = windows_has_descendant_matching(process.process_id, &processes, |child| {
            child.command_line.to_ascii_lowercase().contains("--type=renderer")
        });
        let has_app_server =
            windows_has_descendant_matching(process.process_id, &processes, |child| {
                let command = child.command_line.to_ascii_lowercase();
                command.contains("resources\\codex.exe") && command.contains("app-server")
            });

        if has_window || has_renderer || has_app_server {
            active_pids.push(process.process_id);
        } else {
            // Ignore stale helper trees left behind after the window has already closed.
            ignored_count += 1;
        }
    }

    active_pids.sort_unstable();
    active_pids.dedup();

    Ok((active_pids, ignored_count))
}

#[cfg(windows)]
fn parse_windows_codex_processes(stdout: &str) -> anyhow::Result<Vec<WindowsCodexProcess>> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(trimmed).context("failed to parse Windows process JSON")?;

    match value {
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(|value| {
                serde_json::from_value(value)
                    .context("failed to deserialize Windows Codex process entry")
            })
            .collect(),
        value => Ok(vec![serde_json::from_value(value)
            .context("failed to deserialize Windows Codex process entry")?]),
    }
}

#[cfg(windows)]
fn is_windows_codex_root_process(process: &WindowsCodexProcess) -> bool {
    let name = process.name.to_ascii_lowercase();
    let command = process.command_line.to_ascii_lowercase();

    name == "codex.exe"
        && !command.contains("codex-switcher")
        && !command.contains("--type=")
        && !command.contains("resources\\codex.exe")
}

#[cfg(any(unix, windows))]
fn is_ide_plugin_process(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    lower.contains(".antigravity")
        || lower.contains("openai.chatgpt")
        || lower.contains(".vscode")
}

#[cfg(windows)]
fn windows_has_descendant_matching<F>(
    root_pid: u32,
    processes: &[WindowsCodexProcess],
    mut predicate: F,
) -> bool
where
    F: FnMut(&WindowsCodexProcess) -> bool,
{
    let mut queue = vec![root_pid];
    let mut visited = HashSet::new();

    while let Some(parent_pid) = queue.pop() {
        for process in processes
            .iter()
            .filter(|process| process.parent_process_id == parent_pid)
        {
            if !visited.insert(process.process_id) {
                continue;
            }

            if predicate(process) {
                return true;
            }

            queue.push(process.process_id);
        }
    }

    false
}

#[cfg(unix)]
fn detect_unix_codex_processes_from_ps(stdout: &str, self_pid: u32) -> (Vec<u32>, usize) {
    let mut active_pids = Vec::new();
    let mut ignored_count = 0;

    for process in parse_unix_codex_processes(stdout) {
        if process.pid == self_pid || is_switcher_command(&process.command) {
            continue;
        }

        let executable_lower = process.executable.to_ascii_lowercase();
        if !is_unix_codex_binary(&executable_lower) {
            continue;
        }

        if is_ide_plugin_process(&process.command) || is_unix_codex_helper_process(&process.command)
        {
            ignored_count += 1;
            continue;
        }

        active_pids.push(process.pid);
    }

    active_pids.sort_unstable();
    active_pids.dedup();

    (active_pids, ignored_count)
}

#[cfg(unix)]
fn parse_unix_codex_processes(stdout: &str) -> Vec<UnixCodexProcess> {
    stdout
        .lines()
        .skip(1)
        .filter_map(parse_unix_codex_process_line)
        .collect()
}

#[cfg(unix)]
fn parse_unix_codex_process_line(line: &str) -> Option<UnixCodexProcess> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let parent_pid = parts.next()?.parse::<u32>().ok()?;
    let command = parts.collect::<Vec<_>>().join(" ");
    if command.is_empty() {
        return None;
    }

    let executable = command.split_whitespace().next()?.to_string();

    Some(UnixCodexProcess {
        pid,
        parent_pid,
        command,
        executable,
    })
}

#[cfg(unix)]
fn is_unix_codex_binary(executable_lower: &str) -> bool {
    executable_lower == "codex" || executable_lower.ends_with("/codex")
}

#[cfg(unix)]
fn is_unix_codex_helper_process(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();

    lower.contains("/contents/resources/codex")
        || lower.contains(" app-server")
        || lower.contains("--type=")
        || lower.contains("crashpad")
}

fn is_switcher_command(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    lower.contains("codex-switcher") || lower.contains("codex switcher")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn unix_counts_one_top_level_app_even_with_helper_children() {
        let stdout = "\
  PID  PPID COMMAND
  101     1 /Applications/Codex.app/Contents/MacOS/Codex
  102   101 /Applications/Codex.app/Contents/Resources/codex app-server
  103   101 /Applications/Codex.app/Contents/Resources/codex --type=utility
  104   101 /Applications/Codex.app/Contents/Resources/codex crashpad-handler
";

        let (pids, ignored_count) = detect_unix_codex_processes_from_ps(stdout, 999_999);

        assert_eq!(pids, vec![101]);
        assert_eq!(ignored_count, 3);
    }

    #[cfg(unix)]
    #[test]
    fn unix_ignores_plugin_and_switcher_processes() {
        let stdout = "\
  PID  PPID COMMAND
  201     1 /Applications/Codex.app/Contents/MacOS/Codex
  202     1 /Users/test/.vscode/extensions/openai.chatgpt/bin/codex app-server
  203     1 /Applications/Codex Switcher.app/Contents/MacOS/codex-switcher
";

        let (pids, ignored_count) = detect_unix_codex_processes_from_ps(stdout, 999_999);

        assert_eq!(pids, vec![201]);
        assert_eq!(ignored_count, 1);
    }

    #[cfg(unix)]
    #[test]
    fn unix_counts_multiple_real_root_sessions_once_each() {
        let stdout = "\
  PID  PPID COMMAND
  301     1 /Applications/Codex.app/Contents/MacOS/Codex
  302   301 /Applications/Codex.app/Contents/Resources/codex app-server
  401     1 codex
  402   401 /usr/local/lib/codex/resources/codex app-server
  501     1 /usr/bin/brew upgrade codex
";

        let (pids, ignored_count) = detect_unix_codex_processes_from_ps(stdout, 999_999);

        assert_eq!(pids, vec![301, 401]);
        assert_eq!(ignored_count, 2);
    }
}
