// A birthday is a calendar date. Do not convert it through the PC's time zone.
export function normalizeContactBirthday(value: string | undefined): string {
  const raw = (value ?? "").trim();
  let parts: string[] | null = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(raw);
  if (raw.includes("T") && Number.isNaN(Date.parse(raw))) return "";
  if (!parts) {
    const german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
    if (german) parts = [raw, german[3], german[2], german[1]];
  }
  if (!parts) {
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
    if (compact) parts = compact;
  }
  if (!parts) return "";
  const [, year, month, day] = parts;
  if (Number(year) < 1 || Number(year) >= 4501) return "";
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}
