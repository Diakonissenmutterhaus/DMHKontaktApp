import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import "./CalendarMiniNavigator.css";

type View = "day" | "workweek" | "week" | "month";
interface Props { selectedDate: Date; view: View; onSelectDate: (date: Date) => void; onSelectWeek: (date: Date) => void; }
const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const monthFormatter = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const dayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const monthNames = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("de-DE", { month: "short" }).format(new Date(2026, month, 1)));
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function addDays(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function firstOfMonth(date: Date) { const first = new Date(date); first.setHours(0, 0, 0, 0); first.setDate(1); return first; }
function addMonths(date: Date, amount: number) {
  const next = firstOfMonth(date); next.setMonth(next.getMonth() + amount);
  const last = new Date(next); last.setMonth(last.getMonth() + 1); last.setDate(0);
  next.setDate(Math.min(date.getDate(), last.getDate())); return next;
}
function monday(date: Date) { return addDays(date, 1 - (date.getDay() || 7)); }
function weekNumber(date: Date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const january = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil(((thursday.getTime() - january.getTime()) / 86_400_000 + 1) / 7);
}
function weeks(month: Date) {
  const first = monday(firstOfMonth(month));
  const next = firstOfMonth(addMonths(month, 1));
  const result: Date[][] = [];
  for (let start = first; start < next; start = addDays(start, 7)) result.push(Array.from({ length: 7 }, (_, index) => addDays(start, index)));
  return result;
}

export function CalendarMiniNavigator({ selectedDate, view, onSelectDate, onSelectWeek }: Props) {
  const [month, setMonth] = useState(() => firstOfMonth(selectedDate));
  const [expanded, setExpanded] = useState(true);
  const [picker, setPicker] = useState(false);
  const [year, setYear] = useState(String(selectedDate.getFullYear()));
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const monthButton = useRef<HTMLButtonElement>(null);
  const focusDate = useRef<string | null>(null);
  const selectedTime = selectedDate.getTime();
  useEffect(() => {
    const selected = new Date(selectedTime);
    setMonth(current => selected < current || selected >= firstOfMonth(addMonths(current, 2)) ? firstOfMonth(selected) : current);
  }, [selectedTime]);
  useEffect(() => {
    if (!focusDate.current) return;
    const frame = window.requestAnimationFrame(() => {
      const key = focusDate.current;
      const button = root.current?.querySelector<HTMLButtonElement>(`button[data-date="${key}"][data-in-month="true"]`) ?? root.current?.querySelector<HTMLButtonElement>(`button[data-date="${key}"]`);
      button?.focus(); focusDate.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [month, selectedTime]);
  const months = useMemo(() => [month, firstOfMonth(addMonths(month, 1))], [month]);
  const selected = dateKey(selectedDate);
  const today = dateKey(new Date());
  const weekStart = dateKey(monday(selectedDate));
  const weekEnd = dateKey(addDays(monday(selectedDate), view === "workweek" ? 4 : 6));
  const validYear = /^\d{1,4}$/.test(year) && Number(year) >= 1 && Number(year) <= 9999;
  const selectedMonthVisible = selectedDate >= month && selectedDate < firstOfMonth(addMonths(month, 2));
  const stopPicker = () => { setPicker(false); monthButton.current?.focus(); };
  const navigateDay = (event: KeyboardEvent<HTMLButtonElement>, day: Date) => {
    let next: Date;
    switch (event.key) {
      case "ArrowLeft": next = addDays(day, -1); break;
      case "ArrowRight": next = addDays(day, 1); break;
      case "ArrowUp": next = addDays(day, -7); break;
      case "ArrowDown": next = addDays(day, 7); break;
      case "Home": next = monday(day); break;
      case "End": next = addDays(monday(day), 6); break;
      case "PageUp": next = addMonths(day, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonths(day, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    focusDate.current = dateKey(next);
    onSelectDate(next);
  };
  return <div className="calendar-mini" ref={root}>
    <div className="calendar-mini-header">
      <button className="calendar-mini-collapse" type="button" aria-label={expanded ? "Mini-Kalender einklappen" : "Mini-Kalender ausklappen"} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(open => !open)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
      <button ref={monthButton} className="calendar-mini-month-title" type="button" aria-expanded={picker} aria-label={`Monat und Jahr auswählen, ${monthFormatter.format(month)}`} onClick={() => { setExpanded(true); setYear(String(month.getFullYear())); setPicker(open => !open); }}>{monthFormatter.format(month)}</button>
      <button className="calendar-mini-arrow" type="button" title="Vorheriger Monat" aria-label="Vorheriger Monat im Mini-Kalender" onClick={() => { setPicker(false); setMonth(current => firstOfMonth(addMonths(current, -1))); }}><ChevronUp size={16} /></button>
      <button className="calendar-mini-arrow" type="button" title="Nächster Monat" aria-label="Nächster Monat im Mini-Kalender" onClick={() => { setPicker(false); setMonth(current => firstOfMonth(addMonths(current, 1))); }}><ChevronDown size={16} /></button>
    </div>
    {expanded && <div id={id}>
      {picker ? <div className="calendar-mini-picker" role="group" aria-label="Monat und Jahr auswählen" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); stopPicker(); } }}>
        <div className="calendar-mini-year">
          <button type="button" aria-label="Vorheriges Jahr" disabled={!validYear || Number(year) === 1} onClick={() => setYear(String(Number(year) - 1))}><ChevronLeft size={16} /></button>
          <label>Jahr<input type="number" min={1} max={9999} value={year} onChange={event => setYear(event.target.value)} /></label>
          <button type="button" aria-label="Nächstes Jahr" disabled={!validYear || Number(year) === 9999} onClick={() => setYear(String(Number(year) + 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="calendar-mini-month-picker">{monthNames.map((name, index) => <button type="button" key={name} disabled={!validYear} aria-pressed={month.getMonth() === index && month.getFullYear() === Number(year)} onClick={() => { const next = firstOfMonth(month); next.setFullYear(Number(year), index, 1); setMonth(next); stopPicker(); }}>{name}</button>)}</div>
        <button type="button" className="calendar-mini-picker-back" onClick={stopPicker}>Zurück zu den Tagen</button>
      </div> : <div className="calendar-mini-months">{months.map((visibleMonth, index) => <section className="calendar-mini-month" key={dateKey(visibleMonth)}>
        {index > 0 && <h4>{monthFormatter.format(visibleMonth)}</h4>}
        <div role="grid" aria-label={monthFormatter.format(visibleMonth)}>
          <div className="calendar-mini-row calendar-mini-weekdays" role="row"><span role="columnheader" title="Kalenderwoche">KW</span>{weekdays.map(day => <span role="columnheader" key={day} title={day}>{day[0]}</span>)}</div>
          {weeks(visibleMonth).map(days => <div className="calendar-mini-row" role="row" key={dateKey(days[0])}>
            <div role="rowheader"><button className={`calendar-mini-week${(view === "week" || view === "workweek") && dateKey(days[0]) === weekStart ? " in-period" : ""}`} type="button" aria-label={`Kalenderwoche ${weekNumber(days[0])} auswählen, ab ${dayFormatter.format(days[0])}`} onClick={() => onSelectWeek(days[0])}>{weekNumber(days[0])}</button></div>
            {days.map(day => {
              const key = dateKey(day);
              const inMonth = day.getMonth() === visibleMonth.getMonth();
              const inPeriod = (view === "week" || view === "workweek") && key >= weekStart && key <= weekEnd;
              const classes = `${inMonth ? "" : "outside"}${inPeriod ? " in-period" : ""}${key === selected ? " selected" : ""}${key === today ? " today" : ""}`;
              return <div role="gridcell" aria-selected={key === selected || inPeriod} className={inPeriod ? "in-period" : ""} key={key}><button type="button" className={classes} data-date={key} data-in-month={inMonth} aria-label={dayFormatter.format(day)} aria-current={key === today ? "date" : undefined} tabIndex={inMonth && (selectedMonthVisible ? key === selected : index === 0 && day.getDate() === 1) ? 0 : -1} onClick={() => onSelectDate(day)} onKeyDown={event => navigateDay(event, day)}>{day.getDate()}</button></div>;
            })}
          </div>)}
        </div>
      </section>)}</div>}
      <button className="calendar-mini-today" type="button" onClick={() => { const today = new Date(); setMonth(firstOfMonth(today)); setPicker(false); onSelectDate(today); }}>Heute</button>
    </div>}
  </div>;
}
