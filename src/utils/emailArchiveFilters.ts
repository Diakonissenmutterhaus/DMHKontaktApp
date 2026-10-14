export type EmailDatePreset = "all" | "today" | "week" | "month" | "custom";

function dayString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function emailDatePreset(preset: EmailDatePreset, now = new Date()) {
  if (preset === "all" || preset === "custom") return { from: "", to: "" };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (preset === "week" ? 6 : preset === "month" ? 29 : 0));
  return { from: dayString(start), to: dayString(now) };
}

function localDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return dayString(date) === value ? date : null;
}

// Local calendar days match the dates shown in the reader. Advance by a calendar
// day, not 24 hours, so both DST transition days are included exactly once.
export function emailDateBounds(from: string, to: string) {
  const start = from ? localDay(from) : null;
  const end = to ? localDay(to) : null;
  if ((from && !start) || (to && !end) || (start && end && start > end)) {
    return { fromAt: null, beforeAt: null, valid: false };
  }
  if (end) end.setDate(end.getDate() + 1);
  return { fromAt: start?.toISOString() ?? null, beforeAt: end?.toISOString() ?? null, valid: true };
}
