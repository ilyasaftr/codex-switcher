import type { UsageInfo } from "@/types";
import { UsageProgressBar, getRemainingPercent } from "@/components/UsageProgressBar";

interface UsageBarProps {
  usage?: UsageInfo;
  loading?: boolean;
  error?: string | null;
}

function formatResetTime(resetAt: number | null | undefined): string {
  if (!resetAt) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = resetAt - now;
  if (diff <= 0) return "now";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function formatExactResetTime(resetAt: number | null | undefined): string {
  if (!resetAt) return "";

  const date = new Date(resetAt * 1000);
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  const day = date.getDate();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = date.getHours() >= 12 ? "PM" : "AM";
  const hour12 = date.getHours() % 12 || 12;

  return `${month} ${day}, ${hour12}:${minutes} ${period}`;
}

function formatWindowDuration(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function RateLimitBar({
  label,
  usedPercent,
  windowMinutes,
  resetsAt,
}: {
  label: string;
  usedPercent: number;
  windowMinutes?: number | null;
  resetsAt?: number | null;
}) {
  const remainingPercent = getRemainingPercent(usedPercent) ?? 0;

  const windowLabel = formatWindowDuration(windowMinutes);
  const resetLabel = formatResetTime(resetsAt);
  const exactResetLabel = formatExactResetTime(resetsAt);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="font-medium text-foreground">
          {label}
          {windowLabel ? <span className="ml-1 text-muted-foreground">({windowLabel})</span> : null}
        </div>
        <div className="text-muted-foreground">
          {remainingPercent.toFixed(0)}% left
          {resetLabel ? ` · resets ${resetLabel}` : ""}
          {exactResetLabel ? ` (${exactResetLabel})` : ""}
        </div>
      </div>

      <UsageProgressBar usedPercent={usedPercent} />
    </div>
  );
}

export function UsageBar({ usage, loading, error }: UsageBarProps) {
  if (loading && !usage) {
    return (
      <div className="space-y-3">
        <div className="h-2 animate-pulse rounded-full bg-border/70" />
        <div className="h-2 animate-pulse rounded-full bg-border/55" />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Syncing current rate limits.</div>
        {error ? <div className="text-xs text-muted-foreground">{error}</div> : null}
      </div>
    );
  }

  if (usage.error && !loading) {
    return <div className="text-sm text-muted-foreground">{usage.error}</div>;
  }

  const hasPrimary =
    usage.primary_used_percent !== null && usage.primary_used_percent !== undefined;
  const hasSecondary =
    usage.secondary_used_percent !== null && usage.secondary_used_percent !== undefined;

  if (!hasPrimary && !hasSecondary) {
    return <div className="text-sm text-muted-foreground">No rate limit data available.</div>;
  }

  return (
    <div className="space-y-3">
      {hasPrimary ? (
        <RateLimitBar
          label="Primary Window"
          usedPercent={usage.primary_used_percent!}
          windowMinutes={usage.primary_window_minutes}
          resetsAt={usage.primary_resets_at}
        />
      ) : null}
      {hasSecondary ? (
        <RateLimitBar
          label="Weekly Window"
          usedPercent={usage.secondary_used_percent!}
          windowMinutes={usage.secondary_window_minutes}
          resetsAt={usage.secondary_resets_at}
        />
      ) : null}
      {usage.credits_balance ? (
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Credits {usage.credits_balance}
        </div>
      ) : null}
      {!loading && error ? (
        <div className="text-xs text-muted-foreground">Showing last known usage data.</div>
      ) : null}
    </div>
  );
}
