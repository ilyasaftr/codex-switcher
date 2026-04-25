import { describe, expect, it } from "vitest";

import type { AccountWithUsage } from "@/types";
import {
  buildAccountGroups,
  getGroupVisibleAccounts,
  getGroupDefaultAccount,
  getGroupIdentity,
} from "@/lib/account-groups";

function account(overrides: Partial<AccountWithUsage>): AccountWithUsage {
  return {
    id: overrides.id ?? "account-1",
    name: overrides.name ?? "fallback-name",
    email: overrides.email ?? null,
    plan_type: overrides.plan_type ?? "team",
    subscription_expires_at: overrides.subscription_expires_at ?? null,
    team_name: overrides.team_name ?? null,
    team_info_updated_at: overrides.team_info_updated_at ?? null,
    auth_mode: overrides.auth_mode ?? "chat_g_p_t",
    is_active: overrides.is_active ?? false,
    created_at: overrides.created_at ?? "2026-04-19T00:00:00.000Z",
    last_used_at: overrides.last_used_at ?? null,
    usage: overrides.usage,
    usageLoading: overrides.usageLoading ?? false,
  };
}

describe("account groups", () => {
  it("groups duplicate emails into one row", () => {
    const groups = buildAccountGroups([
      account({
        id: "a",
        email: "team@example.com",
        team_name: "Alpha",
      }),
      account({
        id: "b",
        email: "TEAM@example.com",
        team_name: "Beta",
      }),
      account({
        id: "c",
        email: "solo@example.com",
        team_name: "Solo",
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].accounts).toHaveLength(2);
    expect(groups[0].identity).toBe("team@example.com");
    expect(groups[1].identity).toBe("solo@example.com");
  });

  it("falls back to account name when email is missing", () => {
    const groups = buildAccountGroups([
      account({ id: "a", email: null, name: "Workspace A" }),
      account({ id: "b", email: null, name: "Workspace B" }),
    ]);

    expect(groups.map((group) => group.identity)).toEqual([
      "Workspace A",
      "Workspace B",
    ]);
  });

  it("prefers the active account as the default representative", () => {
    const grouped = buildAccountGroups([
      account({
        id: "a",
        email: "team@example.com",
        team_name: "Alpha",
      }),
      account({
        id: "b",
        email: "team@example.com",
        team_name: "Beta",
        is_active: true,
      }),
    ])[0];

    expect(getGroupDefaultAccount(grouped).id).toBe("b");
  });

  it("falls back to best usage, then earliest reset, then team name", () => {
    const grouped = buildAccountGroups([
      account({
        id: "a",
        email: "team@example.com",
        team_name: "Zulu",
        usage: {
          account_id: "a",
          plan_type: "team",
          primary_used_percent: 20,
          primary_window_minutes: 300,
          primary_resets_at: 100,
          secondary_used_percent: 50,
          secondary_window_minutes: 10080,
          secondary_resets_at: 200,
          has_credits: null,
          unlimited_credits: null,
          credits_balance: null,
          error: null,
        },
      }),
      account({
        id: "b",
        email: "team@example.com",
        team_name: "Alpha",
        usage: {
          account_id: "b",
          plan_type: "team",
          primary_used_percent: 20,
          primary_window_minutes: 300,
          primary_resets_at: 90,
          secondary_used_percent: 50,
          secondary_window_minutes: 10080,
          secondary_resets_at: 200,
          has_credits: null,
          unlimited_credits: null,
          credits_balance: null,
          error: null,
        },
      }),
      account({
        id: "c",
        email: "team@example.com",
        team_name: "Beta",
        usage: {
          account_id: "c",
          plan_type: "team",
          primary_used_percent: 10,
          primary_window_minutes: 300,
          primary_resets_at: 200,
          secondary_used_percent: 50,
          secondary_window_minutes: 10080,
          secondary_resets_at: 300,
          has_credits: null,
          unlimited_credits: null,
          credits_balance: null,
          error: null,
        },
      }),
    ])[0];

    expect(getGroupDefaultAccount(grouped).id).toBe("c");
  });

  it("returns the display identity for grouped rows", () => {
    const grouped = buildAccountGroups([
      account({ id: "a", email: "team@example.com", team_name: "Alpha" }),
    ])[0];

    expect(getGroupIdentity(grouped)).toBe("team@example.com");
  });

  it("keeps sibling teams visible when only one team from the email is active", () => {
    const grouped = buildAccountGroups([
      account({
        id: "a",
        email: "team@example.com",
        team_name: "Alpha",
        is_active: true,
      }),
      account({
        id: "b",
        email: "team@example.com",
        team_name: "Beta",
      }),
      account({
        id: "c",
        email: "team@example.com",
        team_name: "Gamma",
      }),
    ])[0];

    expect(getGroupVisibleAccounts(grouped, "a").map((account) => account.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("hides the whole group when the active email has no remaining teams", () => {
    const grouped = buildAccountGroups([
      account({
        id: "a",
        email: "solo@example.com",
        team_name: "Solo",
        is_active: true,
      }),
    ])[0];

    expect(getGroupVisibleAccounts(grouped, "a")).toHaveLength(0);
  });
});
