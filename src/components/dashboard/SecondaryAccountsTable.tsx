import { ArrowRightLeft, Trash2 } from "lucide-react";

import type { AccountWithUsage } from "@/types";
import type { AccountGroup } from "@/lib/account-groups";
import { getAccountVariantLabel, getGroupVisibleAccounts } from "@/lib/account-groups";
import { formatResetLine } from "@/components/dashboard/secondary-accounts-format";
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
  if (account.usageLoading) {
    return {
      summary: "Syncing",
      primaryReset: "Primary reset unavailable",
      weeklyReset: "Weekly reset unavailable",
    };
  }

  if (!account.usage || account.usage.error) {
    return {
      summary: account.usage?.error ? "Unavailable" : "Pending",
      primaryReset: "Primary reset unavailable",
      weeklyReset: "Weekly reset unavailable",
    };
  }

  const primary = formatRemaining(account.usage.primary_used_percent);
  const weekly = formatRemaining(account.usage.secondary_used_percent);

  return {
    summary:
      primary && weekly
        ? `${primary} primary · ${weekly} weekly`
        : primary
          ? `${primary} primary`
          : weekly
            ? `${weekly} weekly`
            : "No data",
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
    <div className={cn("overflow-hidden rounded-xl border", className)}>
      <div className="max-h-[min(60vh,760px)] overflow-y-auto overflow-x-hidden">
        <div className="space-y-4 p-3">
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
                className="overflow-hidden rounded-2xl border bg-background/40"
              >
                <div className="border-b px-4 py-3">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {maskValue(group.identity, identityMasked)}
                  </div>
                </div>

                <div className="divide-y">
                  {visibleAccounts.map((account) => {
                    const isMasked = maskedAccountIds.has(account.id);
                    const isSwitching = switchingId === account.id;
                    const usage = formatUsage(account);

                    return (
                      <div
                        key={account.id}
                        className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,120px)_minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <div className="inline-flex max-w-full items-center rounded-full border bg-background/80 px-3 py-1 text-xs font-medium text-foreground">
                            <span className="truncate">
                              {maskValue(getAccountVariantLabel(account), isMasked)}
                            </span>
                          </div>
                        </div>

                        <div className="min-w-0 text-sm text-muted-foreground">
                          <div className="truncate font-medium text-foreground">
                            {usage.summary}
                          </div>
                          <div className="mt-1 text-xs leading-5 tracking-[0.04em]">
                            {usage.primaryReset}
                          </div>
                          <div className="mt-1 text-xs leading-5 tracking-[0.04em]">
                            {usage.weeklyReset}
                          </div>
                        </div>

                        <div className="flex items-start justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
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
                            className="size-8"
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
