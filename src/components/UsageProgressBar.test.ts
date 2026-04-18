import { describe, expect, it } from "vitest";

import {
  getRemainingPercent,
  getUsageProgressColorClass,
} from "@/components/UsageProgressBar";

describe("usage progress bar helpers", () => {
  it("computes remaining percent from used percent", () => {
    expect(getRemainingPercent(0)).toBe(100);
    expect(getRemainingPercent(35)).toBe(65);
    expect(getRemainingPercent(100)).toBe(0);
    expect(getRemainingPercent(null)).toBeNull();
  });

  it("uses green, amber, and red thresholds as remaining drops", () => {
    expect(getUsageProgressColorClass(80)).toBe("bg-emerald-500");
    expect(getUsageProgressColorClass(25)).toBe("bg-amber-500");
    expect(getUsageProgressColorClass(5)).toBe("bg-red-500");
    expect(getUsageProgressColorClass(null)).toBe("bg-border/40");
  });
});
