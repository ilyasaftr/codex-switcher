import { cn } from "@/lib/utils";

export type UsageProgressBarSize = "default" | "compact";

export function getRemainingPercent(usedPercent: number | null | undefined) {
  if (usedPercent === null || usedPercent === undefined) return null;
  return Math.max(0, 100 - usedPercent);
}

export function getUsageProgressColorClass(remainingPercent: number | null) {
  if (remainingPercent === null) return "bg-border/40";
  if (remainingPercent <= 10) return "bg-red-500";
  if (remainingPercent <= 30) return "bg-amber-500";
  return "bg-emerald-500";
}

interface UsageProgressBarProps {
  usedPercent?: number | null;
  size?: UsageProgressBarSize;
  className?: string;
}

export function UsageProgressBar({
  usedPercent,
  size = "default",
  className,
}: UsageProgressBarProps) {
  const remainingPercent = getRemainingPercent(usedPercent);
  const isCompact = size === "compact";

  return (
    <div
      className={cn(
        "rounded-full",
        isCompact ? "h-1 bg-border/45" : "h-2 bg-border/60",
        className
      )}
    >
      <div
        className={cn(
          "rounded-full transition-all duration-300",
          isCompact ? "h-1 opacity-75" : "h-2",
          getUsageProgressColorClass(remainingPercent)
        )}
        style={{ width: `${Math.min(remainingPercent ?? 0, 100)}%` }}
      />
    </div>
  );
}
