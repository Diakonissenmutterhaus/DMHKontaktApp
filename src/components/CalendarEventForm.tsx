import {
  AlarmClock, AlignLeft, Calendar, CalendarClock, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, ExternalLink, Link2, Lock, LockOpen,
  List, ListOrdered, MapPin, MoreHorizontal, Printer, Repeat2, Save, Tag, Trash2, UserPlus, Users, Video, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  CalendarAvailability, CalendarDestination, CalendarEvent, CalendarMeetingOptions, CalendarRecurrence,
  CalendarRecurrenceFrequency
} from "../types/calendar";
import { calendarColorOptions, calendarColorValue, expandCalendarEvents, parseCalendarDate } from "../utils/calendar";

interface CalendarEventFormProps {
  value: CalendarEvent;
  isNew: boolean;
  categories: Array<{ name: string; color: string }>;
  events: CalendarEvent[];
  calendars?: CalendarDestination[];
  calendarsLoading?: boolean;
  calendarsError?: string;
  onChange: (value: CalendarEvent) => void;
  onSave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

const defaultMeeting: CalendarMeetingOptions = {
  requiredAttendees: [], optionalAttendees: [], showAs: "busy", reminderMinutes: 15,
  isPrivate: false, isOnlineMeeting: false, onlineMeetingUrl: ""
};

const availabilityLabels: Record<CalendarAvailability, string> = {
  free: "Frei", tentative: "Mit Vorbehalt", busy: "Beschäftigt",
  oof: "Abwesend", workingElsewhere: "An anderem Ort"
};
const plannerHourHeight = 60;
const plannerMinimumEventHeight = 28;

function AvailabilityIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x={3} y={3} width={18} height={18} rx={1} />
      <path d="M3 9 9 3M3 15 15 3M7 21 21 7M13 21 21 13" />
    </svg>
  );
}

function attendeeValues(raw: string): string[] {
  return raw.split(/[;,\n]/).map((entry) => entry.trim()).filter(Boolean);
}

function timeParts(value: string) {
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

function dateTimeValue(date: string, time: string) {
  return `${date}T${time || "00:00"}`;
}

function addDateDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function dateSpanDays(startDate: string, exclusiveEndDate: string): number {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${exclusiveEndDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function eventMinutes(value: string): number {
  const date = parseCalendarDate(value);
  return date ? date.getHours() * 60 + date.getMinutes() : 0;
}

function eventDurationMinutes(event: CalendarEvent): number {
  const start = parseCalendarDate(event.startsAt);
  const end = parseCalendarDate(event.endsAt);
  return start && end ? Math.max(15, (end.getTime() - start.getTime()) / 60_000) : 60;
}

function plannerTimeRange(event: CalendarEvent): string {
  const formatter = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  const start = parseCalendarDate(event.startsAt);
  const end = parseCalendarDate(event.endsAt);
  return start && end ? `${formatter.format(start)}–${formatter.format(end)}` : "";
}

function plannerEventLayouts(events: CalendarEvent[], date: string) {
  const dayStart = parseCalendarDate(`${date}T00:00`);
  if (!dayStart) return [];
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  const segments = events.flatMap((event) => {
    const start = parseCalendarDate(event.startsAt);
    const end = parseCalendarDate(event.endsAt);
    if (!start || !end || end <= start || start >= dayEnd || end <= dayStart) return [];
    const startMinutes = start < dayStart ? 0 : eventMinutes(event.startsAt);
    const endMinutes = end >= dayEnd ? 1440 : eventMinutes(event.endsAt);
    const height = Math.max(plannerMinimumEventHeight, (endMinutes - startMinutes) / 60 * plannerHourHeight - 2);
    return [{ event, startMinutes, height, layoutEnd: startMinutes + (height + 2) / plannerHourHeight * 60 }];
  }).sort((left, right) => left.startMinutes - right.startMinutes || right.layoutEnd - left.layoutEnd);
  const groups: Array<typeof segments> = [];
  let groupEnd = -1;
  for (const segment of segments) {
    if (!groups.length || segment.startMinutes >= groupEnd) {
      groups.push([]);
      groupEnd = -1;
    }
    groups[groups.length - 1].push(segment);
    groupEnd = Math.max(groupEnd, segment.layoutEnd);
  }
  return groups.flatMap((group) => {
    const laneEnds: number[] = [];
    const assigned = group.map((segment) => {
      let lane = laneEnds.findIndex((end) => end <= segment.startMinutes);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segment.layoutEnd;
      return { ...segment, lane };
    });
    return assigned.map((segment) => ({ ...segment, lanes: laneEnds.length }));
  });
}

export function CalendarEventForm({ value, isNew, categories, events, calendars = [], calendarsLoading = false, calendarsError = "", onChange, onSave, onDelete, onCancel }: CalendarEventFormProps) {
  const [optionalVisible, setOptionalVisible] = useState((value.meeting?.optionalAttendees.length ?? 0) > 0);
  const [plannerVisible, setPlannerVisible] = useState(true);
  const [endDateVisible, setEndDateVisible] = useState(false);
  const [requiredAttendeesText, setRequiredAttendeesText] = useState((value.meeting?.requiredAttendees ?? []).join("; "));
  const [optionalAttendeesText, setOptionalAttendeesText] = useState((value.meeting?.optionalAttendees ?? []).join("; "));
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const update = <Key extends keyof CalendarEvent>(key: Key, fieldValue: CalendarEvent[Key]) => onChange({ ...value, [key]: fieldValue });
  const meeting = { ...defaultMeeting, ...value.meeting };
  const onlineMeetingLocked = Boolean(meeting.onlineMeetingUrl) || (value.id.startsWith("m365:") && meeting.isOnlineMeeting);
  const updateMeeting = (changes: Partial<CalendarMeetingOptions>) => update("meeting", { ...meeting, ...changes });
  const categoryNames = categories.map((category) => category.name);
  const selectedCategory = categories.find((category) => category.name === value.category);
  const selectedCategoryColor = calendarColorOptions.find((color) => color.value === calendarColorValue(selectedCategory?.color ?? value.color))?.border ?? "#64748b";
  const calendarLabel = value.source.trim() && value.source !== "local" ? value.source : "DMH Backup";
  const calendarSourceId = value.calendarSourceId ?? calendars.find((calendar) => value.id.startsWith(`m365:${calendar.id}:`))?.id ?? calendars.find((calendar) => calendar.id === `local:${calendarLabel}`)?.id ?? "";
  const recurrence = value.recurrence ?? null;
  const recurrencePreset = !recurrence ? "none" : recurrence.frequency === "monthly" && recurrence.interval === 6 ? "semiannual" : recurrence.frequency;
  const starts = timeParts(value.startsAt);
  const ends = timeParts(value.endsAt);
  const allDayInclusiveEndDate = value.isAllDay ? addDateDays(ends.date, -1) : ends.date;
  const showEndDate = endDateVisible || value.isAllDay || starts.date !== ends.date;
  const plannerDateLabel = starts.date ? new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${starts.date}T12:00`)) : "Datum auswählen";
  const validRange = Boolean(value.startsAt && value.endsAt && new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime());
  const durationMinutes = Math.round(eventDurationMinutes(value));
  const durationLabel = value.isAllDay
    ? "Ganztägig"
    : durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)} ${Math.floor(durationMinutes / 60) === 1 ? "Stunde" : "Stunden"}${durationMinutes % 60 ? ` ${durationMinutes % 60} Min.` : ""}`
      : `${durationMinutes} Minuten`;

  const startDate = () => {
    const date = new Date(value.startsAt);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  };

  const setRecurrencePreset = (preset: string) => {
    if (preset === "none") { update("recurrence", null); return; }
    const start = startDate();
    const frequency: CalendarRecurrenceFrequency = preset === "semiannual" ? "monthly" : preset as CalendarRecurrenceFrequency;
    const next: CalendarRecurrence = { frequency, interval: preset === "semiannual" ? 6 : 1 };
    if (frequency === "weekly") next.daysOfWeek = [start.getDay()];
    if (frequency === "monthly") next.dayOfMonth = start.getDate();
    if (frequency === "yearly") { next.dayOfMonth = start.getDate(); next.monthOfYear = start.getMonth() + 1; }
    update("recurrence", next);
  };

  const updateRecurrence = (changes: Partial<CalendarRecurrence>) => {
    if (recurrence) update("recurrence", { ...recurrence, ...changes });
  };

  const toggleRecurrenceWeekday = (weekday: number) => {
    if (!recurrence) return;
    const current = new Set(recurrence.daysOfWeek ?? [startDate().getDay()]);
    if (current.has(weekday) && current.size > 1) current.delete(weekday); else current.add(weekday);
    updateRecurrence({ daysOfWeek: Array.from(current).sort() });
  };

  const updateCategory = (categoryName: string) => {
    const category = categories.find((entry) => entry.name === categoryName);
    onChange({ ...value, category: categoryName, color: category?.color ?? value.color });
  };

  const updateStart = (nextStart: string) => {
    const oldStart = parseCalendarDate(value.startsAt);
    const oldEnd = parseCalendarDate(value.endsAt);
    const nextDate = parseCalendarDate(nextStart);
    if (!oldStart || !oldEnd || !nextDate) { update("startsAt", nextStart); return; }
    const nextEnd = new Date(nextDate.getTime() + Math.max(15 * 60_000, oldEnd.getTime() - oldStart.getTime()));
    const localEnd = new Date(nextEnd.getTime() - nextEnd.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    onChange({ ...value, startsAt: nextStart, endsAt: localEnd });
  };

  const toggleAllDay = (checked: boolean) => {
    const startDate = starts.date || new Date().toISOString().slice(0, 10);
    if (checked) {
      const currentEndDate = ends.date || startDate;
      const span = dateSpanDays(startDate, currentEndDate) + (currentEndDate > startDate ? 1 : 0);
      onChange({
        ...value,
        isAllDay: true,
        startsAt: dateTimeValue(startDate, "00:00"),
        endsAt: dateTimeValue(addDateDays(startDate, span), "00:00")
      });
      return;
    }
    const finalDate = allDayInclusiveEndDate < startDate ? startDate : allDayInclusiveEndDate;
    onChange({
      ...value,
      isAllDay: false,
      startsAt: dateTimeValue(startDate, "09:00"),
      endsAt: dateTimeValue(finalDate, "10:00")
    });
  };

  const updateAllDayStart = (nextDate: string) => {
    const span = dateSpanDays(starts.date, ends.date);
    onChange({
      ...value,
      startsAt: dateTimeValue(nextDate, "00:00"),
      endsAt: dateTimeValue(addDateDays(nextDate, span), "00:00")
    });
  };

  const updateAllDayEnd = (inclusiveEndDate: string) => {
    const safeEndDate = inclusiveEndDate < starts.date ? starts.date : inclusiveEndDate;
    onChange({ ...value, endsAt: dateTimeValue(addDateDays(safeEndDate, 1), "00:00") });
  };

  const plannerEvents = useMemo(() => {
    const plannerStart = parseCalendarDate(`${starts.date}T00:00:00`);
    const plannerEnd = plannerStart ? new Date(plannerStart.getFullYear(), plannerStart.getMonth(), plannerStart.getDate() + 1) : null;
    if (!plannerStart || !plannerEnd) return [];
    return expandCalendarEvents(events.filter((event) => event.id !== value.id), plannerStart, plannerEnd)
      .filter((event) => {
        const eventStart = parseCalendarDate(event.startsAt);
        const eventEnd = parseCalendarDate(event.endsAt);
        return Boolean(eventStart && eventEnd && eventStart < plannerEnd && eventEnd > plannerStart);
      })
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }, [events, starts.date, value.id]);
  const plannerAllDayEvents = plannerEvents.filter((event) => event.isAllDay);
  const plannerTimedEvents = plannerEvents.filter((event) => !event.isAllDay);
  const plannerLayouts = plannerEventLayouts([...plannerTimedEvents, ...(!value.isAllDay && validRange ? [value] : [])], starts.date);

  useEffect(() => {
    if (!plannerVisible || !timelineRef.current) return;
    const timeline = timelineRef.current;
    const frame = window.requestAnimationFrame(() => {
      const start = value.isAllDay ? 8 * plannerHourHeight : eventMinutes(value.startsAt) / 60 * plannerHourHeight;
      const height = Math.min(24 * plannerHourHeight - start, eventDurationMinutes(value) / 60 * plannerHourHeight);
      const target = value.isAllDay || height > timeline.clientHeight - plannerHourHeight
        ? start - plannerHourHeight / 2
        : start + height / 2 - timeline.clientHeight / 2;
      timeline.scrollTop = Math.max(0, target);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [plannerVisible, value.startsAt, value.endsAt, value.isAllDay]);

  const addAgenda = () => {
    if (!value.description.trim()) update("description", "Agenda\n• ");
    window.setTimeout(() => descriptionRef.current?.focus(), 0);
  };

  const addDescriptionList = (numbered: boolean) => {
    const input = descriptionRef.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selection = value.description.slice(start, end);
    const list = (selection || " ").split("\n").map((line, index) => `${numbered ? `${index + 1}.` : "•"} ${line}`).join("\n");
    const prefix = start > 0 && value.description[start - 1] !== "\n" ? "\n" : "";
    update("description", `${value.description.slice(0, start)}${prefix}${list}${value.description.slice(end)}`);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, start + prefix.length + list.length);
    });
  };

  const shiftEventDay = (days: number) => {
    const shift = (dateValue: string) => {
      const date = parseCalendarDate(dateValue);
      if (!date) return dateValue;
      date.setDate(date.getDate() + days);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    };
    onChange({ ...value, startsAt: shift(value.startsAt), endsAt: shift(value.endsAt) });
  };

  return (
    <section className="calendar-meeting-editor">
      <header className="calendar-meeting-titlebar">
        <div className="calendar-meeting-title-copy">
          <span className="calendar-meeting-title-icon" aria-hidden="true"><CalendarDays size={25} /></span>
          <span>
            <strong>{isNew ? "Neuer Termin" : "Termin bearbeiten"}</strong>
          </span>
        </div>
        <button type="button" onClick={onCancel} aria-label="Schließen"><X size={21} /></button>
      </header>

      <div className="calendar-meeting-commandbar">
        <div className="calendar-meeting-tabs" role="group" aria-label="Ereignis oder Serie">
          <button className={!recurrence ? "active" : ""} type="button" aria-pressed={!recurrence} onClick={() => setRecurrencePreset("none")}><Calendar size={16} /> Ereignis</button>
          <button className={recurrence ? "active" : ""} type="button" aria-pressed={Boolean(recurrence)} onClick={() => { if (!recurrence) setRecurrencePreset("weekly"); }}><Repeat2 size={16} /> Serie</button>
        </div>
        <label className="calendar-command-select calendar-command-availability"><AvailabilityIcon /><select aria-label="Anzeigen als" value={meeting.showAs} onChange={(event) => updateMeeting({ showAs: event.target.value as CalendarAvailability })}>{Object.entries(availabilityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="calendar-command-select calendar-command-compact" title={meeting.reminderMinutes == null ? "Keine Erinnerung" : meeting.reminderMinutes === 0 ? "Erinnerung: Zum Start" : `Erinnerung: ${meeting.reminderMinutes} Minuten vorher`}><AlarmClock size={18} /><ChevronDown size={12} /><select aria-label="Erinnerung" value={meeting.reminderMinutes ?? "none"} onChange={(event) => updateMeeting({ reminderMinutes: event.target.value === "none" ? null : Number(event.target.value) })}><option value="none">Keine Erinnerung</option><option value="0">Zum Start</option><option value="5">5 Minuten vorher</option><option value="15">15 Minuten vorher</option><option value="30">30 Minuten vorher</option><option value="60">1 Stunde vorher</option><option value="1440">1 Tag vorher</option></select></label>
        <label className="calendar-command-select calendar-command-compact" title={`Kategorie: ${value.category || "Keine Kategorie"}`}><Tag size={18} style={{ color: value.category ? selectedCategoryColor : undefined }} /><ChevronDown size={12} /><select aria-label="Kategorie" value={value.category} onChange={(event) => updateCategory(event.target.value)}><option value="">Keine Kategorie</option>{value.category && !categoryNames.includes(value.category) && <option value={value.category}>{value.category}</option>}{categories.map((category) => <option value={category.name} key={category.name}>{category.name}</option>)}</select></label>
        <label className="calendar-command-select calendar-command-compact" title={`Sichtbarkeit: ${meeting.isPrivate ? "Privat" : "Standard"}`}>{meeting.isPrivate ? <Lock size={18} /> : <LockOpen size={18} />}<ChevronDown size={12} /><select aria-label="Sichtbarkeit" value={meeting.isPrivate ? "private" : "normal"} onChange={(event) => updateMeeting({ isPrivate: event.target.value === "private" })}><option value="normal">Standard</option><option value="private">Privat</option></select></label>
        <button className="calendar-command-icon calendar-command-print" type="button" onClick={() => window.print()} aria-label="Drucken" title="Drucken"><Printer size={18} /></button>
        <details className="calendar-command-more">
          <summary aria-label="Weitere Terminoptionen" title="Weitere Terminoptionen"><MoreHorizontal size={20} /></summary>
          <div className="calendar-command-more-panel">
            <label><input type="checkbox" checked={endDateVisible} onChange={(event) => setEndDateVisible(event.target.checked)} /> Enddatum anzeigen</label>
            {!isNew && <button className="danger" type="button" onClick={onDelete}><Trash2 size={17} /> Termin löschen</button>}
          </div>
        </details>
        <button className="primary calendar-meeting-save" type="button" onClick={onSave} disabled={!value.title.trim() || !value.startsAt || !validRange}><Save size={17} /> Speichern</button>
      </div>

      <div className={plannerVisible ? "calendar-meeting-layout" : "calendar-meeting-layout planner-hidden"}>
        <main className="calendar-meeting-fields">
          <div className="calendar-meeting-scroll">
            <section className="calendar-meeting-details-card calendar-meeting-section-card" aria-label="Termindaten">
              <div className="calendar-meeting-field title-field"><AlignLeft size={20} /><input value={value.title} onChange={(event) => update("title", event.target.value)} placeholder="Titel hinzufügen" autoFocus /></div>
              <div className="calendar-meeting-field attendee-field"><Users size={20} /><input value={requiredAttendeesText} onChange={(event) => { setRequiredAttendeesText(event.target.value); updateMeeting({ requiredAttendees: attendeeValues(event.target.value) }); }} placeholder="Teilnehmer hinzufügen" /><button type="button" aria-expanded={optionalVisible} onClick={() => setOptionalVisible((visible) => !visible)}>{optionalVisible ? "Optional ausblenden" : "+ Optional"}</button></div>
              {optionalVisible && <div className="calendar-meeting-field attendee-field optional"><UserPlus size={20} /><input value={optionalAttendeesText} onChange={(event) => { setOptionalAttendeesText(event.target.value); updateMeeting({ optionalAttendees: attendeeValues(event.target.value) }); }} placeholder="Optionale Teilnehmer einladen" /></div>}
              <div className="calendar-meeting-field calendar-date-field">
                <CalendarClock size={20} />
                <div className="calendar-date-editor">
                  <div className={`calendar-date-controls${value.isAllDay ? " all-day" : ""}${showEndDate ? " with-end-date" : ""}`}>
                    <input aria-label="Startdatum" type="date" value={starts.date} onChange={(event) => value.isAllDay ? updateAllDayStart(event.target.value) : updateStart(dateTimeValue(event.target.value, starts.time))} />
                    {!value.isAllDay && <input aria-label="Startzeit" type="time" value={starts.time} onChange={(event) => updateStart(dateTimeValue(starts.date, event.target.value))} />}
                    <span>–</span>
                    {showEndDate && <input aria-label="Enddatum" type="date" min={starts.date} value={value.isAllDay ? allDayInclusiveEndDate : ends.date} onChange={(event) => value.isAllDay ? updateAllDayEnd(event.target.value) : update("endsAt", dateTimeValue(event.target.value, ends.time))} />}
                    {!value.isAllDay && <input aria-label="Endzeit" type="time" value={ends.time} onChange={(event) => update("endsAt", dateTimeValue(ends.date, event.target.value))} />}
                  </div>
                  <label className="calendar-all-day-option">
                    <input type="checkbox" checked={Boolean(value.isAllDay)} onChange={(event) => toggleAllDay(event.target.checked)} />
                    <span>Ganztägig</span>
                  </label>
                </div>
                <button className={plannerVisible ? "active" : ""} type="button" onClick={() => setPlannerVisible((visible) => !visible)}><CalendarClock size={16} /> Planer</button>
              </div>
              {!validRange && <p className="calendar-meeting-validation">Das Ende muss nach dem Beginn liegen.</p>}
              <div className="calendar-meeting-field"><MapPin size={20} /><input value={value.location} onChange={(event) => update("location", event.target.value)} placeholder="Raum oder Ort hinzufügen" /></div>
              <div className="calendar-meeting-field online-field"><Video size={20} /><label className="switch"><input id={`online-meeting-${value.id}`} type="checkbox" checked={meeting.isOnlineMeeting} disabled={onlineMeetingLocked} aria-describedby={onlineMeetingLocked ? `online-meeting-note-${value.id}` : undefined} onChange={(event) => updateMeeting({ isOnlineMeeting: event.target.checked })} /><span /></label><span className="online-meeting-copy"><label className="online-meeting-label" htmlFor={`online-meeting-${value.id}`}>Teams-Besprechung</label>{onlineMeetingLocked && <small id={`online-meeting-note-${value.id}`}>Exchange erlaubt nicht, eine bestehende Online-Besprechung auszuschalten.</small>}{meeting.isOnlineMeeting && !meeting.onlineMeetingUrl && !onlineMeetingLocked && <small>Der Link wird bei der Microsoft-365-Synchronisierung erstellt.</small>}</span>{meeting.onlineMeetingUrl && <a href={meeting.onlineMeetingUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Beitreten</a>}</div>
              {recurrence && <section className="calendar-recurrence-panel" aria-label="Serieneinstellungen">
                <label><span>Wiederholung</span><select value={recurrencePreset} onChange={(event) => setRecurrencePreset(event.target.value)}><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="semiannual">Halbjährlich</option><option value="yearly">Jährlich</option></select></label>
                <label><span>Intervall</span><span className="recurrence-interval-field"><span>Alle</span><input type="number" min={1} max={365} value={recurrence.interval} onChange={(event) => updateRecurrence({ interval: Math.max(1, Number(event.target.value) || 1) })} /><span>{recurrence.frequency === "daily" ? "Tag(e)" : recurrence.frequency === "weekly" ? "Woche(n)" : recurrence.frequency === "monthly" ? "Monat(e)" : "Jahr(e)"}</span></span></label>
                {recurrence.frequency === "weekly" && <div className="field wide"><span>Wochentage</span><div className="recurrence-weekdays">{["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"].map((label, weekday) => <button className={(recurrence.daysOfWeek ?? [startDate().getDay()]).includes(weekday) ? "active" : ""} type="button" onClick={() => toggleRecurrenceWeekday(weekday)} key={label}>{label}</button>)}</div></div>}
                <label><span>Serienende</span><select value={recurrence.count ? "count" : recurrence.until ? "until" : "never"} onChange={(event) => { if (event.target.value === "count") updateRecurrence({ count: 10, until: undefined }); else if (event.target.value === "until") updateRecurrence({ until: value.startsAt.slice(0, 4) + "-12-31", count: undefined }); else updateRecurrence({ count: undefined, until: undefined }); }}><option value="never">Kein Enddatum</option><option value="until">Endet am</option><option value="count">Nach Anzahl</option></select></label>
                {recurrence.until && <label><span>Letzter Termin</span><input type="date" value={recurrence.until} onChange={(event) => updateRecurrence({ until: event.target.value })} /></label>}
                {recurrence.count && <label><span>Anzahl Termine</span><input type="number" min={1} max={10000} value={recurrence.count} onChange={(event) => updateRecurrence({ count: Math.max(1, Number(event.target.value) || 1) })} /></label>}
              </section>}
            </section>

            <section className="calendar-description-card calendar-meeting-section-card" aria-label="Beschreibung und Agenda">
              <div className="calendar-description-editor"><AlignLeft size={20} /><textarea ref={descriptionRef} value={value.description} onChange={(event) => update("description", event.target.value)} placeholder="Beschreibung hinzufügen" /></div>
              <footer className="calendar-description-toolbar">
                <button type="button" onClick={() => addDescriptionList(false)} aria-label="Aufzählung hinzufügen" title="Aufzählung hinzufügen"><List size={18} /></button>
                <button type="button" onClick={() => addDescriptionList(true)} aria-label="Nummerierte Liste hinzufügen" title="Nummerierte Liste hinzufügen"><ListOrdered size={18} /></button>
                <button className="calendar-add-agenda" type="button" onClick={addAgenda}><Link2 size={17} /> Eine Agenda hinzufügen</button>
              </footer>
            </section>
          </div>

        </main>

        {plannerVisible && <aside className="calendar-meeting-planner" aria-label="Tagesübersicht">
          <header>
            <div className="calendar-planner-heading"><CalendarDays size={25} /><span><strong>Tagesübersicht</strong><small>{plannerDateLabel}</small></span></div>
            <div className="calendar-planner-header-actions">
              <div className="calendar-planner-date-navigation">
                <button type="button" onClick={() => shiftEventDay(-1)} aria-label="Vorheriger Tag"><ChevronLeft size={18} /></button>
                <button type="button" onClick={() => shiftEventDay(1)} aria-label="Nächster Tag"><ChevronRight size={18} /></button>
              </div>
              <button className="calendar-planner-close" type="button" onClick={() => setPlannerVisible(false)} aria-label="Planer schließen"><X size={17} /></button>
            </div>
          </header>
          {(plannerAllDayEvents.length > 0 || value.isAllDay) && <div className="calendar-planner-all-day" aria-label="Ganztägige Termine">
            <strong>Ganztägig</strong>
            {plannerAllDayEvents.map((event) => <span key={event.id}>{event.title || "Ohne Titel"}</span>)}
            {value.isAllDay && <span className="draft">{value.title || "Neues ganztägiges Ereignis"}</span>}
          </div>}
          <div className="calendar-planner-timeline" ref={timelineRef}>
            <div className="calendar-planner-grid" style={{ height: `${24 * plannerHourHeight}px`, "--planner-hour-height": `${plannerHourHeight}px` } as CSSProperties}>
              {Array.from({ length: 24 }, (_, hour) => <div className="calendar-planner-hour" key={hour}><time>{hour}:00</time></div>)}
              {plannerLayouts.map(({ event, startMinutes, height, lane, lanes }) => {
                const draft = event.id === value.id;
                const title = event.title || (draft ? "Neuer Termin" : "Ohne Titel");
                const timeRange = plannerTimeRange(event);
                return <div className={`calendar-planner-event${draft ? " draft" : ""}${height < 40 ? " short" : ""}`} key={event.id} title={`${title} · ${timeRange}`} aria-label={`${title}, ${timeRange}`} style={{ top: `${startMinutes / 60 * plannerHourHeight + 1}px`, height: `${height}px`, left: `calc(48px + (100% - 48px) * ${lane / lanes} + 3px)`, width: `calc((100% - 48px) / ${lanes} - 6px)` }}><strong>{title}</strong><span>{timeRange}</span></div>;
              })}
            </div>
          </div>
          <footer className="calendar-planner-duration"><Clock3 size={17} /><span>Dauer: {durationLabel}</span></footer>
        </aside>}
      </div>
      <footer className="calendar-meeting-footer">
        <div className="calendar-source-summary">
          <CalendarClock size={20} />
          <label htmlFor={`calendar-destination-${value.id}`}>Kalender:</label>
          <select id={`calendar-destination-${value.id}`} aria-label="Kalender für diesen Termin" value={calendarSourceId} disabled={calendarsLoading} onChange={(event) => {
            const destination = calendars.find((calendar) => calendar.id === event.target.value);
            if (destination?.editable) onChange({ ...value, calendarSourceId: destination.id, source: destination.name });
          }}>
            {!calendars.some((calendar) => calendar.id === calendarSourceId) && <option value={calendarSourceId}>{calendarLabel}</option>}
            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id} disabled={!calendar.editable}>{calendar.name}{calendar.editable ? "" : ` (${calendar.reason || "Nur lesen"})`}</option>)}
          </select>
          {calendarsLoading && <small role="status">Kalender werden geladen …</small>}
          {calendarsError && <small role="status">{calendarsError}</small>}
        </div>
      </footer>
    </section>
  );
}
