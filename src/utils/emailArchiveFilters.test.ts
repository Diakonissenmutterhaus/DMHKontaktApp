import { describe, expect, it } from "vitest";
import { emailDateBounds, emailDatePreset } from "./emailArchiveFilters";

describe("archive calendar date filters", () => {
  it("includes the end date completely using local midnights, including DST days", () => {
    for (const [month, day] of [[2, 29], [9, 25]]) {
      const value = `2026-${String(month + 1).padStart(2, "0")}-${day}`;
      const bounds = emailDateBounds(value, value);
      expect(bounds).toEqual({ valid: true, fromAt: new Date(2026, month, day).toISOString(), beforeAt: new Date(2026, month, day + 1).toISOString() });
      expect(new Date(bounds.beforeAt!).getHours()).toBe(0);
    }
  });
  it("accepts open periods and rejects invalid or reversed dates", () => {
    expect(emailDateBounds("", "")).toEqual({ valid: true, fromAt: null, beforeAt: null });
    expect(emailDateBounds("2026-10-14", "").beforeAt).toBeNull();
    expect(emailDateBounds("", "2026-10-14").fromAt).toBeNull();
    for (const [from, to] of [["2026-10-15", "2026-10-14"], ["2026-02-30", ""], ["", "garbage"]]) {
      expect(emailDateBounds(from, to).valid).toBe(false);
    }
  });
  it("counts preset periods in calendar days and crosses months and years", () => {
    const now = new Date(2026, 0, 3, 23, 55);
    expect(emailDatePreset("today", now)).toEqual({ from: "2026-01-03", to: "2026-01-03" });
    expect(emailDatePreset("week", now)).toEqual({ from: "2025-12-28", to: "2026-01-03" });
    expect(emailDatePreset("month", now)).toEqual({ from: "2025-12-05", to: "2026-01-03" });
  });
});
