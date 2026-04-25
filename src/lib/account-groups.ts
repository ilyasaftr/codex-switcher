import type { AccountWithUsage } from "@/types";

export interface AccountGroup {
  key: string;
  identity: string;
  normalizedIdentity: string;
  accounts: AccountWithUsage[];
}

function normalizeIdentity(value: string) {
  return value.trim().toLowerCase();
}

export function getGroupIdentity(group: AccountGroup) {
  return group.identity;
}

export function formatPlanLabel(
  planType: string | null,
  authMode: AccountWithUsage["auth_mode"]
) {
  if (planType) {
    return planType.charAt(0).toUpperCase() + planType.slice(1);
  }

  return authMode === "api_key" ? "API Key" : "Unknown";
}

export function getAccountVariantLabel(account: AccountWithUsage) {
  return (
    account.team_name?.trim() ||
    formatPlanLabel(account.plan_type, account.auth_mode) ||
    "Workspace"
  );
}

export function getAccountIdentity(account: AccountWithUsage) {
  return account.email?.trim() || account.name.trim();
}

export function getAccountGroupingKey(account: AccountWithUsage) {
  return normalizeIdentity(getAccountIdentity(account));
}

export function getAccountRemainingPrimary(account: AccountWithUsage) {
  const usedPercent = account.usage?.primary_used_percent;
  if (usedPercent === null || usedPercent === undefined) {
    return Number.NEGATIVE_INFINITY;
  }

  return Math.max(0, 100 - usedPercent);
}

export function getAccountPrimaryResetAt(account: AccountWithUsage) {
  return account.usage?.primary_resets_at ?? Number.POSITIVE_INFINITY;
}

export function getAccountSubscriptionExpiresAt(account: AccountWithUsage) {
  if (!account.subscription_expires_at) return null;

  const timestamp = new Date(account.subscription_expires_at).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareAccountsForDefault(left: AccountWithUsage, right: AccountWithUsage) {
  if (left.is_active !== right.is_active) {
    return left.is_active ? -1 : 1;
  }

  const remainingDiff = getAccountRemainingPrimary(right) - getAccountRemainingPrimary(left);
  if (remainingDiff !== 0) {
    return remainingDiff;
  }

  const resetDiff = getAccountPrimaryResetAt(left) - getAccountPrimaryResetAt(right);
  if (resetDiff !== 0) {
    return resetDiff;
  }

  const variantDiff = getAccountVariantLabel(left).localeCompare(getAccountVariantLabel(right));
  if (variantDiff !== 0) {
    return variantDiff;
  }

  return left.id.localeCompare(right.id);
}

export function getGroupDefaultAccount(group: AccountGroup) {
  return [...group.accounts].sort(compareAccountsForDefault)[0];
}

export function getGroupVisibleAccounts(group: AccountGroup, activeAccountId: string | null) {
  return group.accounts.filter((account) => account.id !== activeAccountId);
}

export function buildAccountGroups(accounts: AccountWithUsage[]): AccountGroup[] {
  const groups = new Map<string, AccountGroup>();

  for (const account of accounts) {
    const identity = getAccountIdentity(account);
    const key = normalizeIdentity(identity);
    const existing = groups.get(key);

    if (existing) {
      existing.accounts.push(account);
      continue;
    }

    groups.set(key, {
      key,
      identity,
      normalizedIdentity: key,
      accounts: [account],
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    accounts: [...group.accounts].sort(compareAccountsForDefault),
  }));
}
