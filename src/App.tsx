import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layers3,
  Plus,
  Rows3,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useAccounts } from "@/hooks/useAccounts";
import {
  buildAccountGroups,
  getAccountPrimaryResetAt,
  getAccountRemainingPrimary,
  getGroupDefaultAccount,
  getGroupVisibleAccounts,
} from "@/lib/account-groups";
import {
  exportFullBackupFile,
  importFullBackupFile,
  invokeBackend,
} from "@/lib/platform";
import type { AccountWithUsage, CodexProcessInfo } from "@/types";
import {
  AccountCard,
  AddAccountModal,
  AppHeader,
  PanelShell,
  SecondaryAccountsTable,
  TransferDialog,
  UpdateChecker,
} from "@/components";
import type { SecondaryAccountsSort } from "@/components/dashboard/SecondaryAccountsTable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { panelActionButtonClassName } from "@/components/dashboard/PanelActionButton";

const THEME_STORAGE_KEY = "codex-switcher-theme";
type ThemeMode = "light" | "dark";
type TransferMode = "slim_export" | "slim_import" | null;

function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "Unknown error";
  }
}

function formatLastUpdated(value: string | null): string {
  if (!value) return "pending";
  const date = new Date(value);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(diff) || diff < 0) return "pending";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getOtherAccountsSortLabel(sort: SecondaryAccountsSort): string {
  if (sort === "reset_asc") return "Reset: earliest to latest";
  if (sort === "reset_desc") return "Reset: latest to earliest";
  if (sort === "remaining_asc") return "% remaining: lowest to highest";
  return "% remaining: highest to lowest";
}

function OtherAccountsLoadingState() {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/18 p-3">
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-[20px] border border-border/60 bg-background/70"
          >
            <div className="border-b border-border/60 px-4 py-2.5">
              <div className="h-4 w-40 animate-pulse rounded-full bg-muted/55" />
            </div>
            <div className="space-y-0">
              {Array.from({ length: index === 1 ? 2 : 1 }).map((__, rowIndex) => (
                <div
                  key={rowIndex}
                  className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,116px)_minmax(0,1fr)_72px]"
                >
                  <div className="h-7 w-24 animate-pulse rounded-full bg-muted/50" />
                  <div className="space-y-2">
                    <div className="h-3.5 w-28 animate-pulse rounded-full bg-muted/55" />
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-muted/45" />
                    <div className="h-3 w-56 animate-pulse rounded-full bg-muted/40" />
                    <div className="h-3.5 w-24 animate-pulse rounded-full bg-muted/55" />
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-muted/45" />
                    <div className="h-3 w-56 animate-pulse rounded-full bg-muted/40" />
                  </div>
                  <div className="flex justify-end gap-1">
                    <div className="size-8 animate-pulse rounded-lg bg-muted/45" />
                    <div className="size-8 animate-pulse rounded-lg bg-muted/45" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const {
    accounts,
    loading,
    error,
    lastRefreshedAt,
    loadAccounts,
    refreshAllAccounts,
    warmupAllAccounts,
    switchAccount,
    deleteAccount,
    importFromFile,
    exportAccountsSlimText,
    importAccountsSlimText,
    startOAuthLogin,
    completeOAuthLogin,
    cancelOAuthLogin,
    loadMaskedAccountIds,
    saveMaskedAccountIds,
  } = useAccounts();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<TransferMode>(null);
  const [configPayload, setConfigPayload] = useState("");
  const [configModalError, setConfigModalError] = useState<string | null>(null);
  const [configCopied, setConfigCopied] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountWithUsage | null>(null);
  const [processInfo, setProcessInfo] = useState<CodexProcessInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExportingSlim, setIsExportingSlim] = useState(false);
  const [isImportingSlim, setIsImportingSlim] = useState(false);
  const [isExportingFull, setIsExportingFull] = useState(false);
  const [isImportingFull, setIsImportingFull] = useState(false);
  const [isWarmingAll, setIsWarmingAll] = useState(false);
  const [maskedAccounts, setMaskedAccounts] = useState<Set<string>>(new Set());
  const [otherAccountsSort, setOtherAccountsSort] =
    useState<SecondaryAccountsSort>("remaining_desc");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      return saved === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });

  const allMasked =
    accounts.length > 0 && accounts.every((account) => maskedAccounts.has(account.id));

  const toggleMaskAll = () => {
    setMaskedAccounts((prev) => {
      const shouldMaskAll = !accounts.every((account) => prev.has(account.id));
      const next = shouldMaskAll
        ? new Set(accounts.map((account) => account.id))
        : new Set<string>();
      void saveMaskedAccountIds(Array.from(next));
      return next;
    });
  };

  const checkProcesses = useCallback(async () => {
    try {
      const info = await invokeBackend<CodexProcessInfo>("check_codex_processes");
      setProcessInfo(info);
      return info;
    } catch (err) {
      console.error("Failed to check processes:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    void checkProcesses();
    const interval = setInterval(() => {
      void checkProcesses();
    }, 3000);
    return () => clearInterval(interval);
  }, [checkProcesses]);

  useEffect(() => {
    loadMaskedAccountIds().then((ids) => {
      if (ids.length > 0) {
        setMaskedAccounts(new Set(ids));
      }
    });
  }, [loadMaskedAccountIds]);

  useEffect(() => {
    const isDark = themeMode === "dark";
    document.documentElement.classList.toggle("dark", isDark);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage failures.
    }
  }, [themeMode]);

  const handleSwitch = async (accountId: string) => {
    const info = await checkProcesses();
    if (info && !info.can_switch) {
      toast.error("Close running Codex processes before switching accounts.");
      return;
    }

    try {
      setSwitchingId(accountId);
      await switchAccount(accountId);
      toast.success("Active account switched.");
    } catch (err) {
      console.error("Failed to switch account:", err);
      toast.error(`Switch failed: ${formatError(err)}`);
    } finally {
      setSwitchingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      await deleteAccount(deleteTarget.id);
      toast.success("Account removed.");
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete account:", err);
      toast.error(`Delete failed: ${formatError(err)}`);
    }
  };

  const handleRefresh = async () => {
    const id = toast.loading("Refreshing account metadata and live usage.");
    setIsRefreshing(true);
    try {
      await refreshAllAccounts();
      toast.success("All accounts refreshed.", { id });
    } catch (err) {
      toast.error(`Refresh failed: ${formatError(err)}`, { id });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleWarmupAll = async () => {
    const id = toast.loading("Sending warm-up requests across all accounts.");
    try {
      setIsWarmingAll(true);
      const summary = await warmupAllAccounts();
      if (summary.total_accounts === 0) {
        toast.error("No accounts available for warm-up.", { id });
        return;
      }

      if (summary.failed_account_ids.length === 0) {
        toast.success(`Warm-up sent for ${summary.warmed_accounts} account(s).`, { id });
      } else {
        toast.error(
          `Warmed ${summary.warmed_accounts}/${summary.total_accounts}. Failed: ${summary.failed_account_ids.length}.`,
          { id }
        );
      }
    } catch (err) {
      console.error("Failed to warm up all accounts:", err);
      toast.error(`Warm-up all failed: ${formatError(err)}`, { id });
    } finally {
      setIsWarmingAll(false);
    }
  };

  const handleExportSlimText = async () => {
    setTransferMode("slim_export");
    setConfigModalError(null);
    setConfigPayload("");
    setConfigCopied(false);

    const id = toast.loading("Preparing slim export payload.");
    try {
      setIsExportingSlim(true);
      const payload = await exportAccountsSlimText();
      setConfigPayload(payload);
      toast.success(`Slim text exported for ${accounts.length} account(s).`, { id });
    } catch (err) {
      console.error("Failed to export slim text:", err);
      const message = formatError(err);
      setConfigModalError(message);
      toast.error(`Slim export failed: ${message}`, { id });
    } finally {
      setIsExportingSlim(false);
    }
  };

  const openImportSlimTextModal = () => {
    setTransferMode("slim_import");
    setConfigModalError(null);
    setConfigPayload("");
    setConfigCopied(false);
  };

  const handleImportSlimText = async () => {
    if (!configPayload.trim()) {
      setConfigModalError("Paste the slim text payload first.");
      return;
    }

    const id = toast.loading("Importing slim payload.");
    try {
      setIsImportingSlim(true);
      setConfigModalError(null);
      const summary = await importAccountsSlimText(configPayload);
      setMaskedAccounts(new Set());
      setTransferMode(null);
      toast.success(
        `Imported ${summary.imported_count}, skipped ${summary.skipped_count} of ${summary.total_in_payload}.`,
        { id }
      );
    } catch (err) {
      console.error("Failed to import slim text:", err);
      const message = formatError(err);
      setConfigModalError(message);
      toast.error(`Slim import failed: ${message}`, { id });
    } finally {
      setIsImportingSlim(false);
    }
  };

  const handleExportFullFile = async () => {
    const id = toast.loading("Preparing encrypted full backup.");
    try {
      setIsExportingFull(true);
      const exported = await exportFullBackupFile();
      if (!exported) {
        toast("Full export cancelled.", { id });
        return;
      }
      toast.success("Encrypted full backup exported.", { id });
    } catch (err) {
      console.error("Failed to export full encrypted file:", err);
      toast.error(`Full export failed: ${formatError(err)}`, { id });
    } finally {
      setIsExportingFull(false);
    }
  };

  const handleImportFullFile = async () => {
    const id = toast.loading("Importing encrypted full backup.");
    try {
      setIsImportingFull(true);
      const summary = await importFullBackupFile();
      if (!summary) {
        toast("Full import cancelled.", { id });
        return;
      }
      const accountList = await loadAccounts(true);
      await refreshAllAccounts(accountList);
      const maskedIds = await loadMaskedAccountIds();
      setMaskedAccounts(new Set(maskedIds));
      toast.success(
        `Imported ${summary.imported_count}, skipped ${summary.skipped_count} of ${summary.total_in_payload}.`,
        { id }
      );
    } catch (err) {
      console.error("Failed to import full encrypted file:", err);
      toast.error(`Full import failed: ${formatError(err)}`, { id });
    } finally {
      setIsImportingFull(false);
    }
  };

  const activeAccount = accounts.find((account) => account.is_active);
  const hasRunningProcesses = Boolean(processInfo && processInfo.count > 0);
  const accountGroups = useMemo(() => buildAccountGroups(accounts), [accounts]);
  const secondaryGroups = useMemo(
    () =>
      accountGroups.filter(
        (group) => getGroupVisibleAccounts(group, activeAccount?.id ?? null).length > 0
      ),
    [accountGroups, activeAccount?.id]
  );

  const sortedSecondaryGroups = useMemo(() => {
    return [...secondaryGroups].sort((a, b) => {
      const leftDefault =
        getGroupVisibleAccounts(a, activeAccount?.id ?? null)[0] ?? getGroupDefaultAccount(a);
      const rightDefault =
        getGroupVisibleAccounts(b, activeAccount?.id ?? null)[0] ?? getGroupDefaultAccount(b);

      const remainingDiff =
        getAccountRemainingPrimary(rightDefault) - getAccountRemainingPrimary(leftDefault);
      const resetDiff =
        getAccountPrimaryResetAt(leftDefault) - getAccountPrimaryResetAt(rightDefault);
      const identityDiff = a.identity.localeCompare(b.identity);

      if (otherAccountsSort === "remaining_desc") {
        if (remainingDiff !== 0) return remainingDiff;
        if (resetDiff !== 0) return resetDiff;
        return identityDiff;
      }

      if (otherAccountsSort === "remaining_asc") {
        if (remainingDiff !== 0) return -remainingDiff;
        if (resetDiff !== 0) return resetDiff;
        return identityDiff;
      }

      if (otherAccountsSort === "reset_asc") {
        if (resetDiff !== 0) return resetDiff;
        if (remainingDiff !== 0) return remainingDiff;
        return identityDiff;
      }

      if (resetDiff !== 0) return -resetDiff;
      if (remainingDiff !== 0) return remainingDiff;
      return identityDiff;
    });
  }, [activeAccount?.id, otherAccountsSort, secondaryGroups]);
  const otherAccountsSortLabel = getOtherAccountsSortLabel(otherAccountsSort);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        processInfo={processInfo}
        allMasked={allMasked}
        themeMode={themeMode}
        isRefreshing={isRefreshing}
        isWarmingAll={isWarmingAll}
        accountsCount={accounts.length}
        lastUpdatedLabel={formatLastUpdated(lastRefreshedAt)}
        onToggleMaskAll={toggleMaskAll}
        onRefreshAll={() => void handleRefresh()}
        onWarmupAll={() => void handleWarmupAll()}
        onToggleTheme={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
        onAddAccount={() => setIsAddModalOpen(true)}
        onExportSlim={() => void handleExportSlimText()}
        onImportSlim={openImportSlimTextModal}
        onExportFull={() => void handleExportFullFile()}
        onImportFull={() => void handleImportFullFile()}
        isExportingSlim={isExportingSlim}
        isImportingSlim={isImportingSlim}
        isExportingFull={isExportingFull}
        isImportingFull={isImportingFull}
      />

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-5 py-8 lg:px-8">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] xl:items-start">
          <div>
            {activeAccount ? (
              <AccountCard
                account={activeAccount}
                onDelete={() => setDeleteTarget(activeAccount)}
                masked={maskedAccounts.has(activeAccount.id)}
              />
            ) : (
              <Card className="flex h-full min-h-[420px] items-center justify-center border-dashed">
                <CardContent className="flex max-w-md flex-col items-center gap-4 p-10 text-center">
                  <div className="rounded-2xl border bg-muted/40 p-4">
                    <Layers3 className="size-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <CardTitle>No active account yet</CardTitle>
                    <CardDescription>
                      Add a ChatGPT account or import an existing `auth.json` to start using the dashboard.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setIsAddModalOpen(true)}>
                    <Plus />
                    Add Account
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <PanelShell
              icon={<Rows3 className="size-4" />}
              title="Other Accounts"
              action={
                !loading && !error && secondaryGroups.length > 0 ? (
                  <Select
                    value={otherAccountsSort}
                    onValueChange={(value) =>
                      setOtherAccountsSort(value as SecondaryAccountsSort)
                    }
                  >
                    <SelectTrigger
                      aria-label="Sort other accounts"
                      title="Sort other accounts"
                      className={`${panelActionButtonClassName} justify-center p-0 shadow-[var(--shadow-soft)] [&>svg:last-child]:hidden`}
                    >
                      <SlidersHorizontal />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reset_asc">Reset: earliest to latest</SelectItem>
                      <SelectItem value="reset_desc">Reset: latest to earliest</SelectItem>
                      <SelectItem value="remaining_desc">
                        % remaining: highest to lowest
                      </SelectItem>
                      <SelectItem value="remaining_asc">
                        % remaining: lowest to highest
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : undefined
              }
              contentClassName="space-y-5"
            >
              {!loading && !error && secondaryGroups.length > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-foreground/85">Sorted by</span>
                    <span className="ml-2 text-muted-foreground">{otherAccountsSortLabel}</span>
                  </div>
                  <span className="shrink-0 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {secondaryGroups.length} groups
                  </span>
                </div>
              ) : null}

              {loading ? <OtherAccountsLoadingState /> : null}

              {!loading && error ? (
                <div className="rounded-2xl border border-amber-300/60 bg-amber-500/10 px-4 py-4 text-sm text-amber-900 shadow-[var(--shadow-soft)] dark:border-amber-800/70 dark:text-amber-200">
                  <div className="font-medium">Couldn’t load other accounts</div>
                  <div className="mt-1 text-sm text-amber-800/90 dark:text-amber-200/80">
                    {error}
                  </div>
                </div>
              ) : null}

              {!loading && !error && secondaryGroups.length === 0 ? (
                <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/70 bg-muted/18 px-8 py-10 text-center shadow-none">
                  <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
                    <Users className="size-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-1.5">
                    <CardTitle>No secondary accounts</CardTitle>
                    <CardDescription>
                      Add more accounts to build a fallback pool for switching and warm-up traffic.
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setIsAddModalOpen(true)}>
                    <Plus />
                    Add Account
                  </Button>
                </div>
              ) : null}

              {!loading && !error && secondaryGroups.length > 0 ? (
                <SecondaryAccountsTable
                  embedded
                  groups={sortedSecondaryGroups}
                  activeAccountId={activeAccount?.id ?? null}
                  switchingId={switchingId}
                  hasRunningProcesses={hasRunningProcesses}
                  maskedAccountIds={maskedAccounts}
                  onSwitch={(accountId) => void handleSwitch(accountId)}
                  onDelete={setDeleteTarget}
                />
              ) : null}
            </PanelShell>
          </div>
        </section>
      </main>

      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onImportFile={importFromFile}
        onStartOAuth={startOAuthLogin}
        onCompleteOAuth={completeOAuthLogin}
        onCancelOAuth={cancelOAuthLogin}
      />

      {transferMode ? (
        <TransferDialog
          open={Boolean(transferMode)}
          mode={transferMode}
          payload={configPayload}
          error={configModalError}
          copied={configCopied}
          busy={transferMode === "slim_export" ? isExportingSlim : isImportingSlim}
          onOpenChange={(open) => {
            if (!open) {
              setTransferMode(null);
              setConfigModalError(null);
              setConfigCopied(false);
            }
          }}
          onPayloadChange={setConfigPayload}
          onCopy={() => {
            if (!configPayload) return;
            void navigator.clipboard
              .writeText(configPayload)
              .then(() => {
                setConfigCopied(true);
                toast.success("Slim payload copied.");
                setTimeout(() => setConfigCopied(false), 1500);
              })
              .catch(() => {
                setConfigModalError("Clipboard unavailable. Copy the payload manually.");
              });
          }}
          onSubmit={() => {
            if (transferMode === "slim_export") {
              void handleExportSlimText();
              return;
            }
            void handleImportSlimText();
          }}
        />
      ) : null}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Remove ${deleteTarget.email ?? deleteTarget.name} from the local switcher profile? This does not revoke the upstream ChatGPT session.`
                : "Remove this account from the local switcher profile?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UpdateChecker />
      <Toaster theme={themeMode} position="bottom-right" />
    </div>
  );
}

export default App;
