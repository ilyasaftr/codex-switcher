import { ShieldCheck, Trash2, UserCheck, UsersRound } from "lucide-react";

import type { AccountWithUsage } from "@/types";
import { formatPlanLabel } from "@/lib/account-groups";
import { cn } from "@/lib/utils";
import { PanelActionButton } from "@/components/dashboard/PanelActionButton";
import { PanelShell } from "@/components/dashboard/PanelShell";
import { UsageBar } from "@/components/UsageBar";

interface AccountCardProps {
  account: AccountWithUsage;
  onDelete: () => void;
  masked?: boolean;
}

interface SummaryRow {
  label: string;
  value: string;
  valueClassName?: string;
  variant?: "default" | "email" | "plan";
}

function maskValue(value: string, masked: boolean) {
  if (!masked) return value;
  return "•".repeat(Math.max(8, Math.min(value.length, 18)));
}

function getSubscriptionSummary(expiresAt: string | null | undefined): SummaryRow {
  if (!expiresAt) {
    return {
      label: "Subscription",
      value: "Unavailable",
      valueClassName: "text-muted-foreground",
    };
  }

  const expiryDate = new Date(expiresAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return {
      label: "Subscription",
      value: "Unavailable",
      valueClassName: "text-muted-foreground",
    };
  }

  const formattedDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(expiryDate);

  const expired = expiryDate.getTime() <= Date.now();

  return {
    label: "Subscription",
    value: `${expired ? "Expired" : "Expires"} ${formattedDate}`,
    valueClassName: expired
      ? "text-destructive"
      : "text-foreground/90",
  };
}

function SummaryRail({
  rows,
  masked,
}: {
  rows: SummaryRow[];
  masked: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-3.5">
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="min-w-0 rounded-xl border border-border/55 bg-background/55 px-3 py-2.5"
          >
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {row.label}
            </div>
            {row.variant === "plan" ? (
              <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <UsersRound className="size-3.5 shrink-0" />
                <span className="truncate">{maskValue(row.value, masked)}</span>
              </div>
            ) : (
              <div
                className={cn(
                  "mt-1.5 text-sm font-medium",
                  row.variant === "email" ? "break-all" : "truncate",
                  row.valueClassName ?? "text-foreground/90"
                )}
                title={masked ? undefined : row.value}
              >
                {maskValue(row.value, masked)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AccountCard({
  account,
  onDelete,
  masked = false,
}: AccountCardProps) {
  const planDisplay = formatPlanLabel(account.plan_type, account.auth_mode);
  const metadataRows = [
    { label: "Email", value: account.email ?? account.name, variant: "email" as const },
    { label: "Plan Type", value: planDisplay, variant: "plan" as const },
    ...(account.plan_type === "team" && account.team_name
      ? [{ label: "Team Name", value: account.team_name }]
      : []),
    ...(account.auth_mode === "chat_g_p_t"
      ? [getSubscriptionSummary(account.subscription_expires_at)]
      : []),
  ];

  return (
    <PanelShell
      icon={<UserCheck className="size-4" />}
      title="Current"
      action={
        <PanelActionButton onClick={onDelete} title="Delete account" aria-label="Delete account">
          <Trash2 />
        </PanelActionButton>
      }
      className="h-full shadow-[var(--shadow-soft)]"
      contentClassName="space-y-4"
    >
      <SummaryRail rows={metadataRows} masked={masked} />

      <div className="rounded-2xl border bg-muted/35 p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Usage Windows
          </div>
          {account.usageLoading && !account.usage ? (
            <span className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Syncing
            </span>
          ) : null}
        </div>
        <UsageBar
          usage={account.usage}
          loading={account.usageLoading}
          error={account.usageError}
        />
      </div>
    </PanelShell>
  );
}
