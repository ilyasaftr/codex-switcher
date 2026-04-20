import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import type {
  AccountInfo,
  AccountRefreshResult,
  AutoRemovedAccount,
  UsageInfo,
  UsageQueryResult,
  AccountWithUsage,
  WarmupAccountResult,
  WarmupSummary,
  ForceSwitchResult,
  ImportAccountsSummary,
} from "../types";
import { invokeBackend, type FileSource } from "../lib/platform";

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const accountsRef = useRef<AccountWithUsage[]>([]);
  const handledAutoRemovedRef = useRef<Set<string>>(new Set());
  const maxConcurrentUsageRequests = 10;
  const maxConcurrentMetadataRequests = 4;

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const mergeAccountWithExistingState = useCallback(
    (nextAccount: AccountInfo, previousList: AccountWithUsage[]): AccountWithUsage => {
      const previous = previousList.find((account) => account.id === nextAccount.id);
      return {
        ...nextAccount,
        usage: previous?.usage,
        usageLoading: previous?.usageLoading ?? false,
        usageError: previous?.usageError ?? null,
      };
    },
    []
  );

  const buildUsageError = useCallback(
    (accountId: string, message: string, planType: string | null): UsageInfo => ({
      account_id: accountId,
      plan_type: planType,
      primary_used_percent: null,
      primary_window_minutes: null,
      primary_resets_at: null,
      secondary_used_percent: null,
      secondary_window_minutes: null,
      secondary_resets_at: null,
      has_credits: null,
      unlimited_credits: null,
      credits_balance: null,
      error: message,
    }),
    []
  );

  const formatAutoRemovedMessage = useCallback(
    (autoRemoved: AutoRemovedAccount, currentAccounts: AccountWithUsage[]) => {
      const account = currentAccounts.find((item) => item.id === autoRemoved.account_id);
      const label = account?.email ?? account?.name ?? "Account";

      if (autoRemoved.reason === "token_invalidated") {
        return `${label} was removed because its authentication token was invalidated. Sign in again.`;
      }

      return `${label} was removed because its workspace is deactivated.`;
    },
    []
  );

  const runWithConcurrency = useCallback(
    async <T,>(
      items: T[],
      worker: (item: T) => Promise<void>,
      concurrency: number
    ) => {
      if (items.length === 0) return;
      const limit = Math.min(Math.max(concurrency, 1), items.length);
      let index = 0;
      const runners = Array.from({ length: limit }, async () => {
        while (true) {
          const current = index++;
          if (current >= items.length) return;
          await worker(items[current]);
        }
      });
      await Promise.allSettled(runners);
    },
    []
  );

  const loadAccounts = useCallback(async (preserveUsage = false) => {
    try {
      setLoading(true);
      setError(null);
      const accountList = await invokeBackend<AccountInfo[]>("list_accounts");
      
      if (preserveUsage) {
        // Preserve existing usage data when just updating account info
        setAccounts((prev) => {
          const usageMap = new Map(
            prev.map((a) => [a.id, { usage: a.usage, usageLoading: a.usageLoading }])
          );
          return accountList.map((a) => ({
            ...a,
            usage: usageMap.get(a.id)?.usage,
            usageLoading: usageMap.get(a.id)?.usageLoading ?? false,
            usageError: prev.find((existing) => existing.id === a.id)?.usageError ?? null,
          }));
        });
      } else {
        setAccounts(accountList.map((a) => ({ ...a, usageLoading: false, usageError: null })));
      }
      return accountList;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAutoRemovedAccounts = useCallback(
    async (autoRemoved: AutoRemovedAccount | AutoRemovedAccount[] | null | undefined) => {
      const removals = Array.isArray(autoRemoved)
        ? autoRemoved
        : autoRemoved
          ? [autoRemoved]
          : [];

      if (removals.length === 0) {
        return accountsRef.current;
      }

      const currentAccounts = accountsRef.current;
      const uniqueRemovals = removals.filter((removal, index, list) => {
        return list.findIndex((item) => item.account_id === removal.account_id) === index;
      });

      for (const removal of uniqueRemovals) {
        const key = `${removal.account_id}:${removal.reason}`;
        if (handledAutoRemovedRef.current.has(key)) continue;
        handledAutoRemovedRef.current.add(key);
        toast.error(formatAutoRemovedMessage(removal, currentAccounts));
      }

      return loadAccounts(true);
    },
    [formatAutoRemovedMessage, loadAccounts]
  );

  const upsertAccount = useCallback(
    (nextAccount: AccountInfo) => {
      setAccounts((prev) => {
        const merged = mergeAccountWithExistingState(nextAccount, prev);
        const index = prev.findIndex((account) => account.id === nextAccount.id);
        if (index === -1) {
          return [...prev, merged];
        }

        const next = [...prev];
        next[index] = merged;
        return next;
      });
    },
    [mergeAccountWithExistingState]
  );

  const refreshUsage = useCallback(
    async (accountList?: AccountInfo[] | AccountWithUsage[]) => {
      try {
        const list = accountList ?? accountsRef.current;
        if (list.length === 0) {
          return;
        }

        const accountIds = list.map((account) => account.id);
        const accountIdSet = new Set(accountIds);
        const autoRemoved: AutoRemovedAccount[] = [];

        setAccounts((prev) =>
          prev.map((account) =>
            accountIdSet.has(account.id)
              ? { ...account, usageLoading: true }
              : account
          )
        );

        await runWithConcurrency(
          accountIds,
          async (accountId) => {
            try {
              const result = await invokeBackend<UsageQueryResult>("get_usage", { accountId });
              if (result.auto_removed) {
                autoRemoved.push(result.auto_removed);
                return;
              }

              if (!result.usage) {
                return;
              }

              setAccounts((prev) =>
                prev.map((account) =>
                  account.id === accountId
                    ? {
                        ...account,
                        usage: result.usage ?? undefined,
                        usageLoading: false,
                        usageError: null,
                      }
                    : account
                )
              );
            } catch (err) {
              console.error("Failed to refresh usage:", err);
              const message = err instanceof Error ? err.message : String(err);
              setAccounts((prev) =>
                prev.map((account) =>
                  account.id === accountId
                    ? {
                        ...account,
                        usage:
                          account.usage ??
                          buildUsageError(accountId, message, account.plan_type ?? null),
                        usageLoading: false,
                        usageError: message,
                      }
                    : account
                )
              );
            }
          },
          maxConcurrentUsageRequests
        );

        if (autoRemoved.length > 0) {
          await handleAutoRemovedAccounts(autoRemoved);
        }

        setLastRefreshedAt(new Date().toISOString());
      } catch (err) {
        console.error("Failed to refresh usage:", err);
        throw err;
      }
    },
    [
      buildUsageError,
      handleAutoRemovedAccounts,
      maxConcurrentUsageRequests,
      runWithConcurrency,
    ]
  );

  const refreshSingleUsage = useCallback(async (accountId: string) => {
    try {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId ? { ...a, usageLoading: true } : a
        )
      );
      const result = await invokeBackend<UsageQueryResult>("get_usage", { accountId });
      if (result.auto_removed) {
        await handleAutoRemovedAccounts(result.auto_removed);
        return;
      }
      if (!result.usage) {
        return;
      }
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? { ...a, usage: result.usage ?? undefined, usageLoading: false, usageError: null }
            : a
        )
      );
    } catch (err) {
      console.error("Failed to refresh single usage:", err);
      const message = err instanceof Error ? err.message : String(err);
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountId
            ? {
                ...a,
                usage: a.usage ?? buildUsageError(accountId, message, a.plan_type ?? null),
                usageLoading: false,
                usageError: message,
              }
            : a
        )
      );
      throw err;
    }
  }, [buildUsageError, handleAutoRemovedAccounts]);

  const refreshAccountMetadata = useCallback(
    async (accountId: string) => {
      const result = await invokeBackend<AccountRefreshResult>("refresh_account_metadata", {
        accountId,
      });
      if (result.auto_removed) {
        await handleAutoRemovedAccounts(result.auto_removed);
        return null;
      }
      if (!result.account) {
        return null;
      }
      upsertAccount(result.account);
      return result.account;
    },
    [handleAutoRemovedAccounts, upsertAccount]
  );

  const refreshAccountsMetadata = useCallback(
    async (
      accountList?: AccountInfo[] | AccountWithUsage[],
      options?: { onlyMissing?: boolean }
    ) => {
      const list = accountList ?? accountsRef.current;
      const targetIds = list
        .filter((account) => {
          if (account.auth_mode !== "chat_g_p_t") return false;
          if (!options?.onlyMissing) return true;
          return !account.team_info_updated_at;
        })
        .map((account) => account.id);

      const autoRemoved: AutoRemovedAccount[] = [];

      await runWithConcurrency(
        targetIds,
        async (accountId) => {
          try {
            const result = await invokeBackend<AccountRefreshResult>("refresh_account_metadata", {
              accountId,
            });
            if (result.auto_removed) {
              autoRemoved.push(result.auto_removed);
              return;
            }
            if (result.account) {
              upsertAccount(result.account);
            }
          } catch (err) {
            console.error("Failed to refresh account metadata:", err);
          }
        },
        maxConcurrentMetadataRequests
      );

      if (autoRemoved.length > 0) {
        return handleAutoRemovedAccounts(autoRemoved);
      }

      return accountsRef.current;
    },
    [handleAutoRemovedAccounts, maxConcurrentMetadataRequests, runWithConcurrency, upsertAccount]
  );

  const refreshAccount = useCallback(
    async (accountId: string) => {
      try {
        await refreshAccountMetadata(accountId);
      } catch (err) {
        console.error("Failed to refresh account metadata:", err);
      }

      await refreshSingleUsage(accountId);
    },
    [refreshAccountMetadata, refreshSingleUsage]
  );

  const refreshAllAccounts = useCallback(
    async (accountList?: AccountInfo[] | AccountWithUsage[]) => {
      const list = accountList ?? accountsRef.current;
      const nextList = await refreshAccountsMetadata(list);
      await refreshUsage(nextList);
    },
    [refreshAccountsMetadata, refreshUsage]
  );

  const warmupAccount = useCallback(async (accountId: string) => {
    try {
      const result = await invokeBackend<WarmupAccountResult>("warmup_account", { accountId });
      if (result.auto_removed) {
        await handleAutoRemovedAccounts(result.auto_removed);
      }
    } catch (err) {
      console.error("Failed to warm up account:", err);
      throw err;
    }
  }, [handleAutoRemovedAccounts]);

  const warmupAllAccounts = useCallback(async () => {
    try {
      const summary = await invokeBackend<WarmupSummary>("warmup_all_accounts");
      if (summary.auto_removed_accounts.length > 0) {
        await handleAutoRemovedAccounts(summary.auto_removed_accounts);
      }
      return summary;
    } catch (err) {
      console.error("Failed to warm up all accounts:", err);
      throw err;
    }
  }, [handleAutoRemovedAccounts]);

  const switchAccount = useCallback(
    async (accountId: string) => {
      try {
        await invokeBackend("switch_account", { accountId });
        await loadAccounts(true); // Preserve usage data
      } catch (err) {
        throw err;
      }
    },
    [loadAccounts]
  );

  const forceSwitchAccount = useCallback(
    async (accountId: string) => {
      try {
        const result = await invokeBackend<ForceSwitchResult>("force_switch_account", {
          accountId,
        });
        await loadAccounts(true);
        return result;
      } catch (err) {
        throw err;
      }
    },
    [loadAccounts]
  );

  const deleteAccount = useCallback(
    async (accountId: string) => {
      try {
        await invokeBackend("delete_account", { accountId });
        await loadAccounts(true);
      } catch (err) {
        throw err;
      }
    },
    [loadAccounts]
  );

  const importFromFile = useCallback(
    async (source: FileSource) => {
      try {
        let account: AccountInfo;
        if (typeof source === "string") {
          account = await invokeBackend<AccountInfo>("add_account_from_file", { path: source });
        } else {
          const contents = await source.text();
          account = await invokeBackend<AccountInfo>("add_account_from_auth_json_text", {
            contents,
          });
        }

        upsertAccount(account);
        await refreshSingleUsage(account.id);
      } catch (err) {
        throw err;
      }
    },
    [refreshSingleUsage, upsertAccount]
  );

  const startOAuthLogin = useCallback(async () => {
    try {
      const info = await invokeBackend<{ auth_url: string; callback_port: number }>("start_login");
      return info;
    } catch (err) {
      throw err;
    }
  }, []);

  const completeOAuthLogin = useCallback(async () => {
    try {
      const account = await invokeBackend<AccountInfo>("complete_login");
      upsertAccount(account);
      await refreshSingleUsage(account.id);
      return account;
    } catch (err) {
      throw err;
    }
  }, [refreshSingleUsage, upsertAccount]);

  const exportAccountsSlimText = useCallback(async () => {
    try {
      return await invokeBackend<string>("export_accounts_slim_text");
    } catch (err) {
      throw err;
    }
  }, []);

  const importAccountsSlimText = useCallback(
    async (payload: string) => {
      try {
        const summary = await invokeBackend<ImportAccountsSummary>("import_accounts_slim_text", {
          payload,
        });
        const accountList = await loadAccounts();
        await refreshUsage(accountList);
        return summary;
      } catch (err) {
        throw err;
      }
    },
    [loadAccounts, refreshUsage]
  );

  const exportAccountsFullEncryptedFile = useCallback(
    async (path: string) => {
      try {
        await invokeBackend("export_accounts_full_encrypted_file", { path });
      } catch (err) {
        throw err;
      }
    },
    []
  );

  const importAccountsFullEncryptedFile = useCallback(
    async (path: string) => {
      try {
        const summary = await invokeBackend<ImportAccountsSummary>(
          "import_accounts_full_encrypted_file",
          { path }
        );
        const accountList = await loadAccounts();
        await refreshUsage(accountList);
        return summary;
      } catch (err) {
        throw err;
      }
    },
    [loadAccounts, refreshUsage]
  );

  const cancelOAuthLogin = useCallback(async () => {
    try {
      await invokeBackend("cancel_login");
    } catch (err) {
      console.error("Failed to cancel login:", err);
    }
  }, []);

  const loadMaskedAccountIds = useCallback(async () => {
    try {
      return await invokeBackend<string[]>("get_masked_account_ids");
    } catch (err) {
      console.error("Failed to load masked account IDs:", err);
      return [];
    }
  }, []);

  const saveMaskedAccountIds = useCallback(async (ids: string[]) => {
    try {
      await invokeBackend("set_masked_account_ids", { ids });
    } catch (err) {
      console.error("Failed to save masked account IDs:", err);
    }
  }, []);

  useEffect(() => {
    loadAccounts().then((accountList) => {
      void refreshAccountsMetadata(accountList, { onlyMissing: true });
      return refreshUsage(accountList);
    });
    
    // Auto-refresh usage every 60 seconds (same as official Codex CLI)
    const interval = setInterval(() => {
      refreshUsage().catch(() => {});
    }, 60000);
    
    return () => clearInterval(interval);
  }, [loadAccounts, refreshAccountsMetadata, refreshUsage]);

  return {
    accounts,
    loading,
    error,
    lastRefreshedAt,
    loadAccounts,
    refreshAllAccounts,
    refreshAccount,
    warmupAccount,
    warmupAllAccounts,
    switchAccount,
    forceSwitchAccount,
    deleteAccount,
    importFromFile,
    exportAccountsSlimText,
    importAccountsSlimText,
    exportAccountsFullEncryptedFile,
    importAccountsFullEncryptedFile,
    startOAuthLogin,
    completeOAuthLogin,
    cancelOAuthLogin,
    loadMaskedAccountIds,
    saveMaskedAccountIds,
  };
}
