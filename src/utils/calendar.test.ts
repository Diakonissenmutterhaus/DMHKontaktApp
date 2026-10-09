import { describe, expect, it, vi } from "vitest";
import { calendarCategoriesStorageKey, calendarCategoriesUpdatedEventName, calendarCategoryRulesStorageKey, calendarColorStyle, mergeMicrosoft365CalendarCategories } from "./calendar";
import { expandCalendarEvents } from "./calendar";
import type { CalendarEvent } from "../types/calendar";

const series: CalendarEvent = { id: "m365:cal:master", title: "Stand-up", startsAt: "2026-10-09T09:00:00", endsAt: "2026-10-09T10:00:00", location: "", description: "", color: "blue", category: "", source: "Microsoft 365", recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [5], count: 4 } };

describe("Exchange series display", () => {
  it("renders the second weekday of each month as one occurrence", () => {
    const master: CalendarEvent = { ...series, startsAt: "2026-10-02T09:00:00", endsAt: "2026-10-02T10:00:00", recurrence: { frequency: "monthly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5], weekOfMonth: 2, weekdaySetPosition: true, count: 3 } };
    const expanded = expandCalendarEvents([master], new Date("2026-10-01T00:00:00"), new Date("2027-01-01T00:00:00"));
    expect(expanded.map(event => event.startsAt.slice(0, 10))).toEqual(["2026-10-02", "2026-11-03", "2026-12-02"]);
  });
  it("respects cancelled and moved occurrences without duplicates or extending the count", () => {
    const master = { ...series, excludedDates: ["2026-10-16", "2026-10-23"] };
    const exception = { ...series, id: "m365:cal:exception", recurrence: null, recurrenceMasterId: master.id, recurrenceId: "2026-10-23", startsAt: "2026-10-24T11:00:00", endsAt: "2026-10-24T12:00:00" };
    const expanded = expandCalendarEvents([master, exception], new Date("2026-10-01T00:00:00"), new Date("2026-11-10T00:00:00"));
    expect(expanded.map(event => event.startsAt.slice(0, 10))).toEqual(["2026-10-09", "2026-10-24", "2026-10-30"]);
  });
  it("honours Sunday as the first day of a biweekly Exchange series", () => {
    const master: CalendarEvent = { ...series, startsAt: "2026-10-04T09:00:00", endsAt: "2026-10-04T10:00:00", recurrence: { frequency: "weekly", interval: 2, daysOfWeek: [0, 1], firstDayOfWeek: 0, count: 4 } };
    const expanded = expandCalendarEvents([master], new Date("2026-10-01T00:00:00"), new Date("2026-11-01T00:00:00"));
    expect(expanded.map(event => event.startsAt.slice(0, 10))).toEqual(["2026-10-04", "2026-10-05", "2026-10-18", "2026-10-19"]);
  });
  it("keeps recurring all-day boundaries at midnight across daylight saving changes", () => {
    const master: CalendarEvent = { ...series, isAllDay: true, startsAt: "2026-03-29T00:00:00", endsAt: "2026-03-30T00:00:00", recurrence: { frequency: "weekly", interval: 1, daysOfWeek: [0], count: 2 } };
    const expanded = expandCalendarEvents([master], new Date("2026-03-01T00:00:00"), new Date("2026-04-10T00:00:00"));
    expect(expanded.map(event => event.endsAt)).toEqual(["2026-03-30T00:00:00", "2026-04-06T00:00:00"]);
  });
});

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
