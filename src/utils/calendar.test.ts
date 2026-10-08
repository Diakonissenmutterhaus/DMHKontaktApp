import { describe, expect, it, vi } from "vitest";
import { calendarCategoriesStorageKey, calendarCategoriesUpdatedEventName, calendarCategoryRulesStorageKey, calendarColorStyle, mergeMicrosoft365CalendarCategories } from "./calendar";

describe("bidirectional category color metadata", () => {
  it("prevents stale imports from restoring a deleted category and honours deliberate recreation", () => {
    localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify([{ names: ["Old"], replacement: null, exchange: true }]));
    mergeMicrosoft365CalendarCategories([{ name: "Old", color: "green" }]);
    expect(JSON.parse(localStorage.getItem(calendarCategoriesStorageKey)!)).toEqual([]);
    localStorage.setItem(calendarCategoryRulesStorageKey, "[]");
    mergeMicrosoft365CalendarCategories([{ name: "Old", color: "purple" }]);
    expect(JSON.parse(localStorage.getItem(calendarCategoriesStorageKey)!)).toEqual([{ name: "Old", color: "purple" }]);
  });
  it("replaces old non-blue colors with confirmed Exchange colors and keeps unrelated local categories", () => {
    localStorage.setItem(calendarCategoriesStorageKey, JSON.stringify([{ name: "Vortrag", color: "red" }, { name: "Local", color: "yellow" }]));
    const listener = vi.fn();
    window.addEventListener(calendarCategoriesUpdatedEventName, listener);
    mergeMicrosoft365CalendarCategories([{ name: "vortrag", color: "purple" }]);
    expect(JSON.parse(localStorage.getItem(calendarCategoriesStorageKey)!)).toEqual([{ name: "Local", color: "yellow" }, { name: "vortrag", color: "purple" }]);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(calendarCategoriesUpdatedEventName, listener);
  });

  it("renders a gray color imported from Teams without replacing it with blue", () => {
    mergeMicrosoft365CalendarCategories([{ name: "Category", color: "gray" }]);
    expect(JSON.parse(localStorage.getItem(calendarCategoriesStorageKey)!)[0].color).toBe("gray");
    expect(calendarColorStyle("gray")).toEqual(expect.objectContaining({ "--event-border": "#6b7280" }));
  });
});
