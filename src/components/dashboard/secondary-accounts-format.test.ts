import { describe, expect, it } from "vitest";

import {
  formatRemainingDuration,
  formatResetLine,
  formatResetTimestamp,
} from "@/components/dashboard/secondary-accounts-format";

describe("secondary account reset formatting", () => {
  it("shows only minutes when less than one hour remains", () => {
    expect(formatRemainingDuration(1_200, 0)).toBe("20m");
    expect(formatRemainingDuration(1_201, 1_200_000)).toBe("1m");
  });

  it("shows hours and minutes when one hour or more remains", () => {
    expect(formatRemainingDuration(4_800, 0)).toBe("1h 20m");
    expect(formatRemainingDuration(7_260, 0)).toBe("2h 1m");
  });

  it("formats reset timestamps with minute precision", () => {
    expect(formatResetTimestamp(1_745_058_600)).toMatch(/^Apr 19, .*\d{2}\s(?:AM|PM)$/);
  });

  it("combines relative time with the exact timestamp", () => {
    expect(formatResetLine("Primary", 4_800, 0)).toMatch(
      /^Primary resets in 1h 20m · Jan 1, .*\:20\s(?:AM|PM)$/
    );
  });

  it("keeps unavailable cases explicit", () => {
    expect(formatResetLine("Weekly", null)).toBe("Weekly reset unavailable");
  });
});
