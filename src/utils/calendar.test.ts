import { describe, expect, it, vi } from "vitest";
import { calendarCategoriesStorageKey, calendarCategoriesUpdatedEventName, calendarColorStyle, mergeMicrosoft365CalendarCategories } from "./calendar";

describe("bidirectional category color metadata", () => {
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
