import { ShieldCheck, Trash2, UserCheck } from "lucide-react";

import type { AccountWithUsage } from "@/types";
import { formatPlanLabel } from "@/lib/account-groups";
import { PanelActionButton } from "@/components/dashboard/PanelActionButton";
import { PanelShell } from "@/components/dashboard/PanelShell";
import { UsageBar } from "@/components/UsageBar";

interface AccountCardProps {
  account: AccountWithUsage;
  onDelete: () => void;
  masked?: boolean;
}

function maskValue(value: string, masked: boolean) {
  if (!masked) return value;
  return "•".repeat(Math.max(8, Math.min(value.length, 18)));
}

function SummaryRail({
  rows,
  masked,
}: {
  rows: Array<{ label: string; value: string }>;
  masked: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 px-4 py-3">
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((row, index) => (
          <div
            key={row.label}
            className={index > 0 ? "md:border-l md:border-border/60 md:pl-4" : undefined}
          >
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {row.label}
            </div>
            <div className="mt-1.5 break-all text-sm font-medium text-foreground/90">
              {maskValue(row.value, masked)}
            </div>
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
    { label: "Email", value: account.email ?? account.name },
    { label: "Plan Type", value: planDisplay },
    ...(account.plan_type === "team" && account.team_name
      ? [{ label: "Team Name", value: account.team_name }]
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
          {account.usageLoading ? (
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
