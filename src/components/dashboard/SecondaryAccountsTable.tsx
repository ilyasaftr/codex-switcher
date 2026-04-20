import { ArrowRightLeft, Trash2 } from "lucide-react";

import type { AccountWithUsage } from "@/types";
import type { AccountGroup } from "@/lib/account-groups";
import { getAccountVariantLabel, getGroupVisibleAccounts } from "@/lib/account-groups";
import { formatResetLine } from "@/components/dashboard/secondary-accounts-format";
import { UsageProgressBar } from "@/components/UsageProgressBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SecondaryAccountsSort =
  | "reset_asc"
  | "reset_desc"
  | "remaining_desc"
  | "remaining_asc";

interface SecondaryAccountsTableProps {
  groups: AccountGroup[];
  activeAccountId: string | null;
  switchingId: string | null;
  hasRunningProcesses: boolean;
  maskedAccountIds: Set<string>;
  onSwitch: (accountId: string) => void;
  onDelete: (account: AccountWithUsage) => void;
  embedded?: boolean;
  className?: string;
}

function formatRemaining(usedPercent: number | null | undefined) {
  if (usedPercent === null || usedPercent === undefined) return null;
  return `${Math.max(0, 100 - usedPercent).toFixed(0)}%`;
}

function formatUsage(account: AccountWithUsage) {
  if (!account.usage || account.usage.error) {
    if (account.usageLoading) {
      return {
        primaryValue: "Syncing",
        weeklyValue: "Syncing",
        primaryUsedPercent: null,
        weeklyUsedPercent: null,
        primaryReset: "Primary reset unavailable",
        weeklyReset: "Weekly reset unavailable",
      };
    }

    return {
      primaryValue: account.usage?.error ? "Unavailable" : "Pending",
      weeklyValue: account.usage?.error ? "Unavailable" : "Pending",
      primaryUsedPercent: null,
      weeklyUsedPercent: null,
      primaryReset: "Primary reset unavailable",
      weeklyReset: "Weekly reset unavailable",
    };
  }

  const primary = formatRemaining(account.usage.primary_used_percent);
  const weekly = formatRemaining(account.usage.secondary_used_percent);

  return {
    primaryValue: primary ?? "No data",
    weeklyValue: weekly ?? "No data",
    primaryUsedPercent: account.usage.primary_used_percent,
    weeklyUsedPercent: account.usage.secondary_used_percent,
    primaryReset: formatResetLine("Primary", account.usage.primary_resets_at),
    weeklyReset: formatResetLine("Weekly", account.usage.secondary_resets_at),
  };
}

function maskValue(value: string, masked: boolean) {
  if (!masked) return value;
  return "•".repeat(Math.max(8, Math.min(value.length, 18)));
}

export function SecondaryAccountsTable({
  groups,
  activeAccountId,
  switchingId,
  hasRunningProcesses,
  maskedAccountIds,
  onSwitch,
  onDelete,
  embedded = false,
  className,
}: SecondaryAccountsTableProps) {
  const content = (
    <div className={cn("overflow-hidden rounded-xl border border-border/70 bg-background/55", className)}>
      <div className="max-h-[min(60vh,760px)] overflow-y-auto overflow-x-hidden">
        <div className="space-y-3 p-2.5">
          {groups.map((group) => {
            const visibleAccounts = getGroupVisibleAccounts(group, activeAccountId);
            if (visibleAccounts.length === 0) {
              return null;
            }

            const identityMasked = visibleAccounts.every((account) =>
              maskedAccountIds.has(account.id)
            );

            return (
              <section
                key={group.key}
                className="overflow-hidden rounded-[20px] border border-border/70 bg-card/85 shadow-[var(--shadow-soft)]"
              >
                <div className="border-b border-border/70 px-4 py-2.5">
                  <div className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                    {maskValue(group.identity, identityMasked)}
                  </div>
                </div>

                <div className="divide-y divide-border/70">
                  {visibleAccounts.map((account) => {
                    const isMasked = maskedAccountIds.has(account.id);
                    const isSwitching = switchingId === account.id;
                    const usage = formatUsage(account);

                    return (
                      <div
                        key={account.id}
                        className="grid items-center gap-x-4 gap-y-2 px-4 py-2.5 md:grid-cols-[minmax(0,116px)_minmax(0,1fr)_72px]"
                      >
                        <div className="flex min-w-0 items-center justify-center">
                          <div className="inline-flex max-w-full items-center rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-foreground/90">
                            <span className="truncate">
                              {maskValue(getAccountVariantLabel(account), isMasked)}
                            </span>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-2">
                          <div className="space-y-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Primary
                              </span>
                              <span className="text-sm font-semibold text-foreground">
                                {usage.primaryValue}
                              </span>
                            </div>
                            <UsageProgressBar
                              usedPercent={usage.primaryUsedPercent}
                              size="compact"
                            />
                            <div className="text-[10px] leading-4 tracking-[0.02em] text-muted-foreground/75">
                              {usage.primaryReset}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Weekly
                              </span>
                              <span className="text-sm font-semibold text-foreground">
                                {usage.weeklyValue}
                              </span>
                            </div>
                            <UsageProgressBar
                              usedPercent={usage.weeklyUsedPercent}
                              size="compact"
                            />
                            <div className="text-[10px] leading-4 tracking-[0.02em] text-muted-foreground/75">
                              {usage.weeklyReset}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg border border-transparent bg-background/70 text-muted-foreground shadow-none transition-colors hover:border-border hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0"
                            disabled={isSwitching || hasRunningProcesses}
                            title={
                              hasRunningProcesses
                                ? "Close all Codex processes first"
                                : `Switch to ${getAccountVariantLabel(account)}`
                            }
                            onClick={() => onSwitch(account.id)}
                          >
                            <ArrowRightLeft />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 rounded-lg border border-transparent bg-background/70 text-muted-foreground shadow-none transition-colors hover:border-border hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0"
                            onClick={() => onDelete(account)}
                            title="Delete account"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card className="border-border/70 bg-card/96">
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
