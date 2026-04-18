export function formatRemainingDuration(
  resetAt: number | null | undefined,
  nowMs = Date.now()
) {
  if (!resetAt) return null;

  const diffMs = Math.max(0, resetAt * 1000 - nowMs);
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${totalMinutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

export function formatResetTimestamp(resetAt: number | null | undefined) {
  if (!resetAt) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(resetAt * 1000));
}

export function formatResetLine(
  label: "Primary" | "Weekly",
  resetAt: number | null | undefined,
  nowMs = Date.now()
) {
  if (!resetAt) return `${label} reset unavailable`;

  const remaining = formatRemainingDuration(resetAt, nowMs);
  const timestamp = formatResetTimestamp(resetAt);

  if (!remaining || !timestamp) {
    return `${label} reset unavailable`;
  }

  return `${label} resets in ${remaining} · ${timestamp}`;
}
