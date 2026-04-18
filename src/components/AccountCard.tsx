import { ShieldCheck, Trash2, UserCheck } from "lucide-react";

import type { AccountWithUsage } from "@/types";
import { formatPlanLabel } from "@/lib/account-groups";
import { PanelShell } from "@/components/dashboard/PanelShell";
import { UsageBar } from "@/components/UsageBar";
import { Button } from "@/components/ui/button";

interface AccountCardProps {
  account: AccountWithUsage;
  onDelete: () => void;
  masked?: boolean;
}

function maskValue(value: string, masked: boolean) {
  if (!masked) return value;
  return "•".repeat(Math.max(8, Math.min(value.length, 18)));
}

function StatRow({
  label,
  value,
  masked,
}: {
  label: string;
  value: string;
  masked: boolean;
}) {
  return (
    <div className="rounded-xl border bg-background/70 px-3 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 break-all text-sm font-medium text-foreground">
        {maskValue(value, masked)}
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
        <Button variant="outline" size="icon" onClick={onDelete} title="Delete account">
          <Trash2 />
        </Button>
      }
      className="h-full shadow-[var(--shadow-soft)]"
      contentClassName="space-y-5"
    >
      <div className="grid gap-3 md:grid-cols-3">
        {metadataRows.map((row) => (
          <StatRow key={row.label} label={row.label} value={row.value} masked={masked} />
        ))}
      </div>

      <div className="rounded-2xl border bg-muted/35 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-muted-foreground" />
            Usage Windows
          </div>
          {account.usageLoading ? (
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
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
