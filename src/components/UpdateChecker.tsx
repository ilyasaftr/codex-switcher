import { useState, useEffect, useCallback } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCcw, Rocket, XCircle } from "lucide-react";

import { isTauriRuntime } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; downloaded: number; total: number | null }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;

    try {
      setStatus({ kind: "checking" });
      setDismissed(false);
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      setStatus(update ? { kind: "available", update } : { kind: "idle" });
    } catch (err) {
      console.error("Update check failed:", err);
      setStatus({ kind: "idle" });
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void checkForUpdate();
  }, [checkForUpdate]);

  const handleDownloadAndInstall = async () => {
    if (status.kind !== "available") return;
    const { update } = status;

    try {
      if (!isTauriRuntime()) return;
      let downloaded = 0;
      let total: number | null = null;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            setStatus({ kind: "downloading", downloaded: 0, total });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setStatus({ kind: "downloading", downloaded, total });
            break;
          case "Finished":
            setStatus({ kind: "ready" });
            break;
        }
      });

      setStatus({ kind: "ready" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Update install failed:", err);
      setStatus({ kind: "error", message });
    }
  };

  const handleRelaunch = async () => {
    try {
      if (!isTauriRuntime()) return;
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      console.error("Relaunch failed:", err);
    }
  };

  if (!isTauriRuntime() || status.kind === "idle" || status.kind === "checking" || dismissed) {
    return null;
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[min(30rem,calc(100vw-2rem))]">
      <Card className="border-border/70 bg-card/96 backdrop-blur-sm">
        <CardContent className="p-4">
          {status.kind === "available" ? (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Rocket className="size-4 text-muted-foreground" />
                  Update ready: v{status.update.version}
                </div>
                {status.update.body ? (
                  <p className="text-sm text-muted-foreground">{status.update.body}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
                  Later
                </Button>
                <Button size="sm" onClick={() => void handleDownloadAndInstall()}>
                  <Download />
                  Install
                </Button>
              </div>
            </div>
          ) : null}

          {status.kind === "downloading" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <Download className="size-4 text-muted-foreground" />
                  Downloading update
                </div>
                <div className="text-muted-foreground">
                  {formatBytes(status.downloaded)}
                  {status.total ? ` / ${formatBytes(status.total)}` : ""}
                </div>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{
                    width:
                      status.total && status.total > 0
                        ? `${Math.min(100, (status.downloaded / status.total) * 100)}%`
                        : "50%",
                  }}
                />
              </div>
            </div>
          ) : null}

          {status.kind === "ready" ? (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <RefreshCcw className="size-4 text-muted-foreground" />
                  Restart required
                </div>
                <p className="text-sm text-muted-foreground">
                  The update has been downloaded and is ready to apply.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
                  Later
                </Button>
                <Button size="sm" onClick={() => void handleRelaunch()}>
                  Restart
                </Button>
              </div>
            </div>
          ) : null}

          {status.kind === "error" ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                <XCircle className="mt-0.5 size-4" />
                <span>Update failed: {status.message}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
