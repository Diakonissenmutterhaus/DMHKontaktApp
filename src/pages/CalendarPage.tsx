import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Copy, Download, Eye, ExternalLink, Filter, Forward, ListChecks, Lock, MoreHorizontal, PanelLeftClose, Palette, Plus, Printer, RefreshCw, Rows3, Settings2, Tag, Trash2, Undo2, Upload, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarReconciliationDialog } from "../components/CalendarReconciliationDialog";
import { CalendarEventForm } from "../components/CalendarEventForm";
import { CalendarCategoryManager } from "../components/CalendarCategoryManager";
import type { CalendarCategoryOperation, Microsoft365SyncSource } from "../types/m365";
import { parseSyncConfig } from "../types/sync";
import { applyCalendarCategoryRules, calendarCategoryRulesStorageKey, mergeImportedCalendarCategories } from "../utils/calendar";
import { ActionResultDialog, type ActionResult } from "../components/ActionResultDialog";
import { EasyImportDialog } from "../components/EasyImportDialog";
import { EmptyImportState } from "../components/EmptyImportState";
import { Microsoft365SyncDialog } from "../components/Microsoft365SyncDialog";
import { StatusMessage } from "../components/StatusMessage";
import type { Page } from "../components/Sidebar";
import type { CalendarAvailability, CalendarEvent } from "../types/calendar";
import { calendarCategoriesStorageKey, calendarCategoriesUpdatedEventName, calendarColorOptions, calendarColorStyle, calendarColorValue, calendarStorageKey, defaultCalendarColor, expandCalendarEvents, exportCalendarIcs, formatCalendarDate, mergeMicrosoft365CalendarCategories, parseCalendarDate } from "../utils/calendar";
import { findExactCalendarDuplicateGroups, removeExactCalendarDuplicates } from "../utils/calendarDuplicates";
import {
  calendarAutomaticSyncStatusEventName,
  calendarChangedEventName,
  calendarStorageUpdatedEventName,
  synchronizationConfigKey,
  type CalendarAutomaticSyncStatus
} from "../utils/automaticCalendarSync";
import {
  listCalendarEvents,
  getAppSetting,
  setAppSetting,
  listMicrosoft365CalendarSources,
  changeCalendarCategories,
  getCalendarCategoryOperation,
  getCalendarCategoryRules,
  listCalendarEventsInRange,
  getMicrosoft365ConnectionStatus,
  getMicrosoft365ReadOnlyTestMode,
  getCalendarOverview,
  listMicrosoft365MasterCategories,
  mergeCalendarEvents,
  moveCalendarEventsToTrash,
  previewMicrosoft365CalendarCategoryRepair,
  repairMicrosoft365CalendarCategories,
  restoreCalendarEvents,
  saveCalendarEvents,
  saveMicrosoft365MasterCategory,
  saveLocalCalendarCategory,
  writeExportFile
} from "../services/db";

const duplicateCleanupBackupKey = "agendakontakte.calendarExactDuplicateCleanupBackup.v1";
const calendarViewStorageKey = "agendakontakte.calendarView.v1";
const advancedCalendarSettingsStorageKey = "agendakontakte.calendarAdvancedSettings.v1";
const compactCalendarHourHeight = 60;
const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const calendarHours = Array.from({ length: 24 }, (_, hour) => hour);
type CalendarView = "day" | "workweek" | "week" | "month";
type CalendarCategory = {
  name: string;
  color: string;
};
const allCategoriesValue = "__all__";

interface CalendarDuplicateCleanupBackup {
  createdAt: string;
  removedEventIds: string[];
}

interface AdvancedCalendarSettings {
  hourHeight: number;
  hiddenSources: string[];
}

const defaultAdvancedCalendarSettings: AdvancedCalendarSettings = { hourHeight: 68, hiddenSources: [] };

function readAdvancedCalendarSettings(): AdvancedCalendarSettings {
  try {
    const value = JSON.parse(localStorage.getItem(advancedCalendarSettingsStorageKey) ?? "{}") as Partial<AdvancedCalendarSettings>;
    return {
      hourHeight: value.hourHeight === 52 || value.hourHeight === 68 || value.hourHeight === 84 ? value.hourHeight : defaultAdvancedCalendarSettings.hourHeight,
      hiddenSources: Array.isArray(value.hiddenSources) ? value.hiddenSources.filter((source): source is string => typeof source === "string") : []
    };
  } catch {
    return defaultAdvancedCalendarSettings;
  }
}

function readDuplicateCleanupBackup(): CalendarDuplicateCleanupBackup | null {
  const raw = localStorage.getItem(duplicateCleanupBackupKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CalendarDuplicateCleanupBackup> & { removedEvents?: CalendarEvent[] };
    if (typeof value.createdAt !== "string") return null;
    const removedEventIds = Array.isArray(value.removedEventIds)
      ? value.removedEventIds.filter((id): id is string => typeof id === "string")
      : Array.isArray(value.removedEvents)
        ? value.removedEvents.map((event) => event.id).filter(Boolean)
        : [];
    return removedEventIds.length > 0 ? { createdAt: value.createdAt, removedEventIds } : null;
  } catch {
    return null;
  }
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(date: Date): Date {
  const day = date.getDay() || 7;
  return addDays(startOfDay(date), 1 - day);
}

function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromInput(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function eventDate(event: CalendarEvent): Date | null {
  return parseCalendarDate(event.startsAt);
}

function eventEndDate(event: CalendarEvent): Date | null {
  return parseCalendarDate(event.endsAt || event.startsAt);
}

function eventTime(event: CalendarEvent): string {
  if (event.isAllDay) return "Ganztägig";
  const date = eventDate(event);
  return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "";
}

function calendarEventDisplayTitle(event: CalendarEvent): string {
  return event.title.trim() || (event.id.startsWith("m365:") ? "Titel in Microsoft 365 nicht verfügbar" : "Ohne Titel");
}

type CalendarEventContextSubmenu = "symbol" | "availability" | "category" | null;

interface CalendarEventContextMenuState {
  event: CalendarEvent;
  x: number;
  y: number;
  submenu: CalendarEventContextSubmenu;
}

function eventTimeRange(event: CalendarEvent): string {
  if (event.isAllDay) return "Ganztägig";
  const starts = eventDate(event);
  const ends = eventEndDate(event);
  if (!starts) return "";
  const formatter = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
  return ends ? `${formatter.format(starts)}–${formatter.format(ends)}` : formatter.format(starts);
}

function toLocalDateTime(value: string): string {
  const date = parseCalendarDate(value);
  if (!date) return value.slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function blankEvent(date = new Date()): CalendarEvent {
  const starts = new Date(date);
  starts.setSeconds(0, 0);
  const ends = new Date(starts.getTime() + 60 * 60 * 1000);
  return {
    id: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
    title: "",
    startsAt: toLocalDateTime(starts.toISOString()),
    endsAt: toLocalDateTime(ends.toISOString()),
    isAllDay: false,
    location: "",
    description: "",
    color: defaultCalendarColor,
    category: "",
    source: "DMH Backup",
    meeting: {
      requiredAttendees: [],
      optionalAttendees: [],
      showAs: "busy",
      reminderMinutes: 15,
      isPrivate: false,
      isOnlineMeeting: false,
      onlineMeetingUrl: ""
    }
  };
}

interface WeekEventLayout {
  event: CalendarEvent;
  startMinutes: number;
  endMinutes: number;
  lane: number;
  lanes: number;
}

interface CalendarTimeSelection {
  dayKey: string;
  anchorMinutes: number;
  currentMinutes: number;
}

interface CalendarEventPointerDrag {
  eventId: string;
  pointerId: number;
  originX: number;
  originY: number;
  offsetMinutes: number;
  dragging: boolean;
}

interface CalendarEventDropPreview {
  event: CalendarEvent;
  dayKey: string;
  kind: "day" | "time";
}

function safeCalendarMinutes(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1_440, Math.round(value / 15) * 15));
}

function calendarTimeSelectionBounds(selection: CalendarTimeSelection) {
  const anchorMinutes = safeCalendarMinutes(selection.anchorMinutes);
  const currentMinutes = safeCalendarMinutes(selection.currentMinutes, anchorMinutes);
  const startMinutes = Math.min(anchorMinutes, currentMinutes);
  const selectedEnd = anchorMinutes === currentMinutes
    ? startMinutes + 30
    : Math.max(anchorMinutes, currentMinutes);
  const endMinutes = Math.min(1_440, Math.max(startMinutes + 15, selectedEnd));
  return { startMinutes, endMinutes };
}

function formatCalendarMinutes(minutes: number): string {
  const safeMinutes = safeCalendarMinutes(minutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutePart = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutePart).padStart(2, "0")}`;
}

function formatTimeSelection(selection: CalendarTimeSelection): string {
  const { startMinutes, endMinutes } = calendarTimeSelectionBounds(selection);
  return `${formatCalendarMinutes(startMinutes)}–${formatCalendarMinutes(endMinutes)}`;
}

function calendarEventDropPreviewStyle(event: CalendarEvent, hourHeight: number, minimumHeight: number): CSSProperties {
  const starts = eventDate(event);
  const ends = eventEndDate(event);
  if (!starts || !ends) return {};
  const dayStart = startOfDay(starts);
  const startMinutes = (starts.getTime() - dayStart.getTime()) / 60_000;
  const durationMinutes = Math.max(15, (ends.getTime() - starts.getTime()) / 60_000);
  return {
    ...calendarColorStyle(event.color),
    top: `${(startMinutes / 60) * hourHeight + 1}px`,
    height: `${Math.max(minimumHeight, (durationMinutes / 60) * hourHeight - 2)}px`
  };
}

interface CalendarMonthSelection {
  anchorIndex: number;
  currentIndex: number;
}

function storedCalendarView(): CalendarView {
  const stored = localStorage.getItem(calendarViewStorageKey);
  return stored === "day" || stored === "workweek" || stored === "week" || stored === "month" ? stored : "month";
}

function isoWeekNumber(date: Date): number {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function weekEventLayouts(day: Date, dayEvents: CalendarEvent[]): WeekEventLayout[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const segments = dayEvents.flatMap((event) => {
    if (event.isAllDay) return [];
    const starts = eventDate(event);
    const ends = eventEndDate(event);
    if (!starts || !ends || ends <= dayStart || starts >= dayEnd) return [];
    const clippedStart = starts < dayStart ? dayStart : starts;
    const clippedEnd = ends > dayEnd ? dayEnd : ends;
    const startMinutes = Math.max(0, (clippedStart.getTime() - dayStart.getTime()) / 60_000);
    return [{
      event,
      startMinutes,
      endMinutes: Math.min(1_440, Math.max((clippedEnd.getTime() - dayStart.getTime()) / 60_000, startMinutes + 15))
    }];
  }).sort((left, right) => left.startMinutes - right.startMinutes || right.endMinutes - left.endMinutes);

  const result: WeekEventLayout[] = [];
  let group: typeof segments = [];
  let groupEnd = -1;
  const flushGroup = () => {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = group.map((segment) => {
      let lane = laneEnds.findIndex((end) => end <= segment.startMinutes);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = segment.endMinutes;
      return { ...segment, lane };
    });
    const lanes = Math.max(1, laneEnds.length);
    result.push(...assigned.map((segment) => ({ ...segment, lanes })));
    group = [];
  };

  for (const segment of segments) {
    if (group.length > 0 && segment.startMinutes >= groupEnd) flushGroup();
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.endMinutes);
  }
  flushGroup();
  return result;
}

interface AllDayEventLayout {
  event: CalendarEvent;
  startIndex: number;
  span: number;
  lane: number;
}

function eventOverlapsDay(event: CalendarEvent, day: Date): boolean {
  const starts = eventDate(event);
  const ends = eventEndDate(event);
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  return Boolean(starts && ends && starts < dayEnd && ends > dayStart);
}

function allDayEventLayouts(days: Date[], events: CalendarEvent[]): AllDayEventLayout[] {
  const segments = events.flatMap((event) => {
    if (!event.isAllDay) return [];
    const includedDays = days.flatMap((day, index) => eventOverlapsDay(event, day) ? [index] : []);
    if (includedDays.length === 0) return [];
    const startIndex = includedDays[0];
    const lastIndex = includedDays[includedDays.length - 1];
    return [{ event, startIndex, span: lastIndex - startIndex + 1 }];
  }).sort((left, right) => left.startIndex - right.startIndex || right.span - left.span || left.event.title.localeCompare(right.event.title, "de"));

  const laneEnds: number[] = [];
  return segments.map((segment) => {
    let lane = laneEnds.findIndex((endIndex) => endIndex <= segment.startIndex);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = segment.startIndex + segment.span;
    return { ...segment, lane };
  });
}

function AllDayEventStrip({ days, events, onOpen, onContextMenu }: { days: Date[]; events: CalendarEvent[]; onOpen: (event: CalendarEvent) => void; onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, calendarEvent: CalendarEvent) => void }) {
  const layouts = allDayEventLayouts(days, events);
  const visibleLayouts = layouts.filter((layout) => layout.lane < 4);
  const hiddenEvents = layouts.length - visibleLayouts.length;
  const rows = Math.max(1, visibleLayouts.reduce((maximum, layout) => Math.max(maximum, layout.lane + 1), 0));
  return (
    <div
      className="calendar-all-day-strip"
      style={{ "--calendar-days": days.length, "--all-day-rows": rows } as CSSProperties}
      aria-label="Ganztägige Ereignisse"
    >
      <div className="calendar-all-day-label"><CalendarDays size={15} aria-hidden="true" /><span>Ganztägig</span>{hiddenEvents > 0 && <small>+{hiddenEvents}</small>}</div>
      {days.map((day, index) => <div className="calendar-all-day-cell" style={{ gridColumn: index + 2 }} key={dateInputValue(day)} />)}
      {visibleLayouts.map((layout) => (
        <button
          className="calendar-all-day-event"
          style={{ ...calendarColorStyle(layout.event.color), gridColumn: `${layout.startIndex + 2} / span ${layout.span}`, gridRow: layout.lane + 1 } as CSSProperties}
          type="button"
          title={`${calendarEventDisplayTitle(layout.event)}${layout.event.location ? `\n${layout.event.location}` : ""}`}
          onClick={() => onOpen(layout.event)}
          onContextMenu={(event) => onContextMenu(event, layout.event)}
          key={`${layout.event.id}-${layout.startIndex}`}
        >
          <span>{calendarEventDisplayTitle(layout.event)}</span>
          {layout.event.location && <small>{layout.event.location}</small>}
        </button>
      ))}
    </div>
  );
}

function spansWholeCalendarDays(event: CalendarEvent): boolean {
  const starts = eventDate(event);
  const ends = eventEndDate(event);
  if (!starts || !ends || ends <= starts) return false;
  const startsAtMidnight = starts.getHours() === 0 && starts.getMinutes() === 0 && starts.getSeconds() === 0;
  const endsAtMidnight = ends.getHours() === 0 && ends.getMinutes() === 0 && ends.getSeconds() === 0;
  return startsAtMidnight && endsAtMidnight;
}

function normalizeEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    // A midnight-to-midnight span is a full calendar day, even if an imported
    // source did not set its all-day flag correctly.
    isAllDay: Boolean(event.isAllDay) || spansWholeCalendarDays(event),
    color: calendarColorValue(event.color),
    category: event.category ?? "",
    meeting: {
      requiredAttendees: event.meeting?.requiredAttendees ?? [],
      optionalAttendees: event.meeting?.optionalAttendees ?? [],
      showAs: event.meeting?.showAs ?? "busy",
      reminderMinutes: event.meeting?.reminderMinutes === undefined ? 15 : event.meeting.reminderMinutes,
      isPrivate: event.meeting?.isPrivate ?? false,
      isOnlineMeeting: event.meeting?.isOnlineMeeting ?? false,
      onlineMeetingUrl: event.meeting?.onlineMeetingUrl ?? ""
    }
  };
}

function normalizeCategory(category: CalendarCategory): CalendarCategory {
  return {
    name: category.name.trim(),
    color: category.color === "gray" ? "gray" : calendarColorValue(category.color)
  };
}

function upsertSortedCalendarEvent(events: CalendarEvent[], event: CalendarEvent): CalendarEvent[] {
  const next = events.filter((entry) => entry.id !== event.id);
  let low = 0;
  let high = next.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (next[middle].startsAt.localeCompare(event.startsAt) <= 0) low = middle + 1;
    else high = middle;
  }
  next.splice(low, 0, event);
  return next;
}

interface CalendarPageProps {
  advancedMode: boolean;
  onAdvancedModeChange: (enabled: boolean) => void;
  onNavigate: (page: Page) => void;
}

export function CalendarPage({ advancedMode, onAdvancedModeChange, onNavigate }: CalendarPageProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [totalCalendarEvents, setTotalCalendarEvents] = useState(0);
  const [calendarSources, setCalendarSources] = useState<string[]>([]);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [easyImportOpen, setEasyImportOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [reconciliationEvents, setReconciliationEvents] = useState<CalendarEvent[]>([]);
  const [categories, setCategories] = useState<CalendarCategory[]>([]);
  const [message, setMessage] = useState("");
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedCalendarSettings>(readAdvancedCalendarSettings);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [view, setView] = useState<CalendarView>(storedCalendarView);
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [destinationCalendars, setDestinationCalendars] = useState<Microsoft365SyncSource[]>([]);
  const [destinationDirections, setDestinationDirections] = useState<Record<string, string>>({});
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsError, setDestinationsError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(allCategoriesValue);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [exactDuplicateGroups, setExactDuplicateGroups] = useState<ReturnType<typeof findExactCalendarDuplicateGroups>>([]);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [eventContextMenu, setEventContextMenu] = useState<CalendarEventContextMenuState | null>(null);
  const [eventToPrint, setEventToPrint] = useState<CalendarEvent | null>(null);
  const [m365SyncDialogOpen, setM365SyncDialogOpen] = useState(false);
  const [categoryConnected, setCategoryConnected] = useState(false);
  const [categoryExchangeNames, setCategoryExchangeNames] = useState<string[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [categoryLoadError, setCategoryLoadError] = useState("");
  const [categoryPending, setCategoryPending] = useState<CalendarCategoryOperation | null>(null);
  const [categoryManagerLoading, setCategoryManagerLoading] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryRepairing, setCategoryRepairing] = useState(false);
  const [categoryReadOnly, setCategoryReadOnly] = useState(false);
  const [duplicateCleanupBackup, setDuplicateCleanupBackup] = useState<CalendarDuplicateCleanupBackup | null>(
    () => readDuplicateCleanupBackup()
  );
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [eventDropPreview, setEventDropPreview] = useState<CalendarEventDropPreview | null>(null);
  const [timeSelection, setTimeSelection] = useState<CalendarTimeSelection | null>(null);
  const [monthSelection, setMonthSelection] = useState<CalendarMonthSelection | null>(null);
  const timeSelectionRef = useRef<CalendarTimeSelection | null>(null);
  const draggedEventIdRef = useRef<string | null>(null);
  const eventPointerDragRef = useRef<CalendarEventPointerDrag | null>(null);
  const suppressEventClickRef = useRef<string | null>(null);
  const timeGridScrollRef = useRef<HTMLDivElement | null>(null);
  const eventsRef = useRef<CalendarEvent[]>([]);
  const duplicateReviewEventsRef = useRef<CalendarEvent[]>([]);

  const displayRange = useMemo(() => {
    if (view === "month") {
      const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
      return { start: first, end: addDays(first, 42) };
    }
    if (view === "workweek") {
      const first = startOfWeek(cursor);
      return { start: first, end: addDays(first, 5) };
    }
    if (view === "week") {
      const first = startOfWeek(cursor);
      return { start: first, end: addDays(first, 7) };
    }
    return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
  }, [cursor, view]);

  const loadVisibleEvents = useCallback(async () => {
    if ("__TAURI_INTERNALS__" in window) {
      let overview = await getCalendarOverview();
      if (overview.total === 0) {
        const legacy = JSON.parse(localStorage.getItem(calendarStorageKey) ?? "[]") as unknown;
        if (Array.isArray(legacy) && legacy.length > 0) {
          await mergeCalendarEvents(legacy as CalendarEvent[]);
          localStorage.removeItem(calendarStorageKey);
          overview = await getCalendarOverview();
          window.dispatchEvent(new Event(calendarChangedEventName));
        }
      }
      const storedEvents = await listCalendarEventsInRange(
        toLocalDateTime(displayRange.end.toISOString()),
        toLocalDateTime(displayRange.start.toISOString())
      );
      const normalized = storedEvents.map(normalizeEvent);
      eventsRef.current = normalized;
      setEvents(normalized);
      setTotalCalendarEvents(overview.total);
      setCalendarSources(overview.sources);
      return;
    }

    const saved = localStorage.getItem(calendarStorageKey);
    const normalized = saved ? (JSON.parse(saved) as CalendarEvent[]).map(normalizeEvent) : [];
    eventsRef.current = normalized;
    setEvents(normalized);
    setTotalCalendarEvents(normalized.length);
    setCalendarSources(Array.from(new Set(normalized.map((event) => event.source?.trim()).filter((source): source is string => Boolean(source)))).sort((left, right) => left.localeCompare(right, "de")));
  }, [displayRange]);

  useEffect(() => {
    void loadVisibleEvents()
      .catch(() => setMessage("Die gespeicherten Kalenderdaten konnten nicht geladen werden."))
      .finally(() => setCalendarLoaded(true));
  }, [loadVisibleEvents]);

  useEffect(() => {
    const reloadCategories = () => {
      try {
        const savedCategories = localStorage.getItem(calendarCategoriesStorageKey);
        if (savedCategories) {
          const storedCategories = (JSON.parse(savedCategories) as CalendarCategory[]).map(normalizeCategory).filter((category) => category.name);
          setCategories(storedCategories);
        }
      } catch {
        setMessage("Die gespeicherten Kalenderkategorien konnten nicht geladen werden.");
      }
    };
    reloadCategories();
    window.addEventListener(calendarCategoriesUpdatedEventName, reloadCategories);
    return () => window.removeEventListener(calendarCategoriesUpdatedEventName, reloadCategories);
  }, []);

  useEffect(() => {
    if (!eventToPrint) return;
    const frame = window.requestAnimationFrame(() => {
      window.print();
      setEventToPrint(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [eventToPrint]);

  useEffect(() => {
    localStorage.setItem(calendarViewStorageKey, view);
  }, [view]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(advancedCalendarSettingsStorageKey, JSON.stringify(advancedSettings));
  }, [advancedSettings]);

  const editingEventId = editingEvent?.id;
  useEffect(() => {
    if (!editingEventId || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    setDestinationCalendars([]);
    setDestinationDirections({});
    setDestinationsLoading(true);
    setDestinationsError("");
    void (async () => {
      const [rawConfig, connection] = await Promise.all([getAppSetting(synchronizationConfigKey), getMicrosoft365ConnectionStatus()]);
      const config = parseSyncConfig(rawConfig);
      const calendars = connection.connected ? await listMicrosoft365CalendarSources(config.sharedMailboxAddresses) : [];
      if (!cancelled) {
        setDestinationCalendars(calendars);
        setDestinationDirections(Object.fromEntries(calendars.map((calendar) => [calendar.id, config.sourceDirections[calendar.id] ?? config.direction])));
        const defaultDestination = calendars.find((calendar) => calendar.editable && config.selectedCalendarSourceIds.includes(calendar.id) && (config.sourceDirections[calendar.id] ?? config.direction) !== "import");
        if (defaultDestination) setEditingEvent((current) => current && editingIsNew && !current.calendarSourceId ? { ...current, calendarSourceId: defaultDestination.id, source: `Microsoft 365 · ${defaultDestination.name}` } : current);
        if (!connection.connected) setDestinationsError("Microsoft 365 ist nicht verbunden.");
      }
    })().catch(() => {
      if (!cancelled) setDestinationsError("Exchange-Kalender konnten nicht geladen werden. Termin erneut öffnen, um es nochmals zu versuchen.");
    }).finally(() => { if (!cancelled) setDestinationsLoading(false); });
    return () => { cancelled = true; };
  }, [editingEventId, editingIsNew]);

  const calendarDestinations = useMemo(() => {
    const localNames = new Set(["DMH Backup", ...calendarSources.filter((source) => source !== "local" && !source.startsWith("Microsoft 365 · "))]);
    if (editingEvent && !editingEvent.id.startsWith("m365:") && !editingEvent.source.startsWith("Microsoft 365 · ")) localNames.add(editingEvent.source && editingEvent.source !== "local" ? editingEvent.source : "DMH Backup");
    const currentExchange = destinationCalendars.find((calendar) => editingEvent?.id.startsWith(`m365:${calendar.id}:`));
    const originReadOnly = Boolean(editingEvent?.id.startsWith("m365:") && (!currentExchange?.editable || destinationDirections[currentExchange.id] === "import"));
    const protectedMeeting = Boolean(editingEvent?.id.startsWith("m365:") && (
      editingEvent.recurrence || editingEvent.recurrenceMasterId || editingEvent.excludedDates?.length
      || editingEvent.meeting?.isOnlineMeeting
      || editingEvent.meeting?.requiredAttendees.length || editingEvent.meeting?.optionalAttendees.length
    ));
    return [
      ...Array.from(localNames).map((name) => ({ id: `local:${name}`, name, editable: !originReadOnly && !protectedMeeting, reason: protectedMeeting ? "Besprechung oder Serie: in Outlook verschieben" : "Quellkalender ist schreibgeschützt" })),
      ...destinationCalendars.map((calendar) => ({
        id: calendar.id,
        name: `Microsoft 365 · ${calendar.name}${calendar.mailbox ? ` · ${calendar.mailbox}` : ""}`,
        editable: calendar.editable && destinationDirections[calendar.id] !== "import" && ((!originReadOnly && !protectedMeeting) || calendar.id === currentExchange?.id),
        reason: protectedMeeting ? "Besprechung oder Serie: in Outlook verschieben" : destinationDirections[calendar.id] === "import" ? "Nur Import" : "Nur lesen"
      }))
    ];
  }, [calendarSources, destinationCalendars, destinationDirections, editingEvent]);

  useEffect(() => {
    const closeContextMenu = () => setEventContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    const reloadStoredEvents = async () => {
      try {
        await loadVisibleEvents();
        setCalendarLoaded(true);
      } catch {
        setMessage("Die von Microsoft 365 empfangenen Kalenderdaten konnten nicht angezeigt werden.");
      }
    };
    const showAutomaticSyncStatus = (event: Event) => {
      const detail = (event as CustomEvent<CalendarAutomaticSyncStatus>).detail;
      if (detail?.message) setMessage(detail.message);
    };
    const reload = () => void reloadStoredEvents();
    window.addEventListener(calendarStorageUpdatedEventName, reload);
    window.addEventListener(calendarAutomaticSyncStatusEventName, showAutomaticSyncStatus);
    return () => {
      window.removeEventListener(calendarStorageUpdatedEventName, reload);
      window.removeEventListener(calendarAutomaticSyncStatusEventName, showAutomaticSyncStatus);
    };
  }, [loadVisibleEvents]);
  const allSortedEvents = useMemo(
    () => expandCalendarEvents(events, displayRange.start, displayRange.end)
      .filter((event) => !advancedMode || !event.source || !advancedSettings.hiddenSources.includes(event.source.trim()))
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt)),
    [advancedMode, advancedSettings.hiddenSources, displayRange, events]
  );
  const categoryOptions = useMemo(
    () => {
      const names = new Set<string>();
      for (const category of categories) if (category.name.trim()) names.add(category.name.trim());
      for (const event of events) if (event.category.trim()) names.add(event.category.trim());
      return Array.from(names).sort((left, right) => left.localeCompare(right, "de"));
    },
    [categories, events]
  );
  const sortedEvents = useMemo(
    () => categoryFilter === allCategoriesValue
      ? allSortedEvents
      : allSortedEvents.filter((event) => event.category.trim() === categoryFilter),
    [allSortedEvents, categoryFilter]
  );
  const exactDuplicateCopies = useMemo(
    () => exactDuplicateGroups.reduce((total, group) => total + group.copies - 1, 0),
    [exactDuplicateGroups]
  );

  const monthDays = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(first);
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  }, [cursor]);

  const weekDays = useMemo(() => {
    const first = startOfWeek(cursor);
    return Array.from({ length: view === "workweek" ? 5 : 7 }, (_, index) => addDays(first, index));
  }, [cursor, view]);

  const weekLayouts = useMemo(() => weekDays.map((day) => {
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const dayEvents = sortedEvents.filter((event) => {
      const starts = eventDate(event);
      const ends = eventEndDate(event);
      return Boolean(starts && ends && starts < dayEnd && ends > dayStart);
    });
    return weekEventLayouts(day, dayEvents);
  }), [sortedEvents, weekDays]);

  const dayLayouts = useMemo(
    () => weekEventLayouts(cursor, sortedEvents.filter((event) => !event.isAllDay)),
    [cursor, sortedEvents]
  );

  const timeGridVisible = calendarLoaded && totalCalendarEvents > 0 && view !== "month";
  useEffect(() => {
    if (!timeGridVisible || !timeGridScrollRef.current) return;
    const now = new Date();
    const weekBasedView = view === "week" || view === "workweek";
    const rangeStart = weekBasedView ? weekDays[0] : startOfDay(cursor);
    const rangeEnd = weekBasedView ? addDays(weekDays[weekDays.length - 1], 1) : addDays(startOfDay(cursor), 1);
    const showsToday = now >= rangeStart && now < rangeEnd;
    const hourHeight = advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight;
    const scroll = timeGridScrollRef.current;
    const frame = window.requestAnimationFrame(() => {
      const timeline = scroll.querySelector<HTMLElement>(".calendar-week-timeline, .calendar-day-timeline");
      if (!timeline) return;
      const pinnedHeight = Array.from(scroll.querySelectorAll<HTMLElement>(".calendar-week-head, .calendar-day-head, .calendar-all-day-strip"))
        .reduce((height, element) => height + element.getBoundingClientRect().height, 0);
      const timelineTop = timeline.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop + scroll.scrollTop;
      const minutes = showsToday ? now.getHours() * 60 + now.getMinutes() : 7 * 60;
      const targetY = timelineTop + (minutes / 60) * hourHeight;
      const viewportY = showsToday ? pinnedHeight + (scroll.clientHeight - pinnedHeight) / 2 : pinnedHeight;
      scroll.scrollTop = Math.max(0, targetY - viewportY);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [advancedMode, advancedSettings.hourHeight, cursor, view, weekDays, timeGridVisible]);

  const eventsForDay = (day: Date) => sortedEvents.filter((event) => {
    if (event.isAllDay) return eventOverlapsDay(event, day);
    const date = eventDate(event);
    return date ? sameDay(date, day) : false;
  });

  const title = view === "month"
    ? new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(cursor)
    : view === "week" || view === "workweek"
      ? `${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(weekDays[0])}–${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(weekDays[weekDays.length - 1])} · Woche ${isoWeekNumber(weekDays[0])}`
      : new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(cursor);

  const persist = (nextEvents: CalendarEvent[]) => {
    const sorted = nextEvents.map(normalizeEvent).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const previousById = new Map(eventsRef.current.map((event) => [event.id, JSON.stringify(event)]));
    const changed = sorted.filter((event) => previousById.get(event.id) !== JSON.stringify(event));
    const nextIds = new Set(sorted.map((event) => event.id));
    const removedIds = eventsRef.current.filter((event) => !nextIds.has(event.id)).map((event) => event.id);
    eventsRef.current = sorted;
    setEvents(sorted);
    if ("__TAURI_INTERNALS__" in window) {
      void (async () => {
        if (changed.length > 0) await saveCalendarEvents(changed);
        if (removedIds.length > 0) await moveCalendarEventsToTrash(removedIds);
        // The automatic sync reads from SQLite. Tell it about the change only
        // once the database write has completed, otherwise a fast sync can
        // inspect the old state and miss a newly created appointment.
        if (changed.length > 0 || removedIds.length > 0) {
          window.dispatchEvent(new Event(calendarChangedEventName));
        }
        await loadVisibleEvents();
      })().catch(() => setMessage("Kalenderänderung konnte nicht sicher gespeichert werden."));
    } else {
      localStorage.setItem(calendarStorageKey, JSON.stringify(sorted));
    }
  };

  const persistSingleEvent = (event: CalendarEvent) => {
    const normalized = normalizeEvent(event);
    const existing = eventsRef.current.some((entry) => entry.id === normalized.id);
    const next = upsertSortedCalendarEvent(eventsRef.current, normalized);
    eventsRef.current = next;
    setEvents(next);
    if (!existing) setTotalCalendarEvents((total) => total + 1);
    if ("__TAURI_INTERNALS__" in window) {
      void saveCalendarEvents([normalized])
        .then(() => window.dispatchEvent(new Event(calendarChangedEventName)))
        .catch(() => setMessage("Kalenderänderung konnte nicht sicher gespeichert werden."));
    } else {
      localStorage.setItem(calendarStorageKey, JSON.stringify(next));
    }
  };

  const persistRemovedEvent = (id: string) => {
    const existing = eventsRef.current.some((event) => event.id === id);
    const next = eventsRef.current.filter((event) => event.id !== id);
    eventsRef.current = next;
    setEvents(next);
    if (existing) setTotalCalendarEvents((total) => Math.max(0, total - 1));
    if ("__TAURI_INTERNALS__" in window) {
      void moveCalendarEventsToTrash([id])
        .then(() => window.dispatchEvent(new Event(calendarChangedEventName)))
        .catch(() => setMessage("Kalenderänderung konnte nicht sicher gespeichert werden."));
    } else {
      localStorage.setItem(calendarStorageKey, JSON.stringify(next));
    }
  };

  const persistCategories = (nextCategories: CalendarCategory[]) => {
    const byName = new Map<string, CalendarCategory>();
    for (const category of nextCategories.map(normalizeCategory).filter((entry) => entry.name)) {
      byName.set(category.name.toLowerCase(), category);
    }
    const sorted = Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name, "de"));
    setCategories(sorted);
    localStorage.setItem(calendarCategoriesStorageKey, JSON.stringify(sorted));
    window.dispatchEvent(new Event(calendarCategoriesUpdatedEventName));
  };

  const persistEventChanges = async (changed: CalendarEvent[]) => {
    if ("__TAURI_INTERNALS__" in window) {
      if (changed.length) await saveCalendarEvents(changed);
      window.dispatchEvent(new Event(calendarChangedEventName));
    } else {
      const allEvents = JSON.parse(localStorage.getItem(calendarStorageKey) ?? "[]") as CalendarEvent[];
      const byId = new Map(changed.map((event) => [event.id, event]));
      localStorage.setItem(calendarStorageKey, JSON.stringify(allEvents.map((event) => byId.get(event.id) ?? event)));
    }
    await loadVisibleEvents();
  };

  const mergeRemoteCategories = (remoteCategories: CalendarCategory[]) => {
    mergeMicrosoft365CalendarCategories(remoteCategories);
  };

  const openCategoryManager = async () => {
    setShowActionsMenu(false);
    setShowCategoryDialog(true);
    setCategoryLoadError("");
    setCategoryManagerLoading(true);
    try {
      const native = "__TAURI_INTERNALS__" in window;
      if (native) {
        const [readOnly, status, pending, rules] = await Promise.all([
          getMicrosoft365ReadOnlyTestMode(), getMicrosoft365ConnectionStatus(),
          getCalendarCategoryOperation(), getCalendarCategoryRules()
        ]);
        setCategoryReadOnly(readOnly);
        setCategoryConnected(status.connected);
        setCategoryPending(pending);
        localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify(rules));
      }
      const allEvents = native ? await listCalendarEvents() : JSON.parse(localStorage.getItem(calendarStorageKey) ?? "[]") as CalendarEvent[];
      const counts: Record<string, number> = {};
      for (const event of allEvents) {
        if (event.category.trim()) counts[event.category.toLowerCase()] = (counts[event.category.toLowerCase()] ?? 0) + 1;
      }
      setCategoryCounts(counts);
      mergeImportedCalendarCategories(allEvents);
      const stored = JSON.parse(localStorage.getItem(calendarCategoriesStorageKey) ?? "[]") as CalendarCategory[];
      persistCategories(applyCalendarCategoryRules(stored));
      if (native && (await getMicrosoft365ConnectionStatus()).connected) {
        const remote = await listMicrosoft365MasterCategories();
        localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify(await getCalendarCategoryRules()));
        setCategoryExchangeNames(remote.map((category) => category.name));
        mergeRemoteCategories(remote);
      }
    } catch (error) {
      setCategoryLoadError(`Kategorien konnten nicht vollständig geladen werden: ${String(error)}. Bitte neu laden.`);
    } finally {
      setCategoryManagerLoading(false);
    }
  };

  const syncCategoryWithExchange = async (category: CalendarCategory) => {
    if (!("__TAURI_INTERNALS__" in window)) return false;
    const status = await getMicrosoft365ConnectionStatus();
    if (!status.connected) { await saveLocalCalendarCategory(category); return false; }
    const saved = await saveMicrosoft365MasterCategory(category);
    mergeRemoteCategories([saved]);
    await loadVisibleEvents();
    window.dispatchEvent(new Event(calendarStorageUpdatedEventName));
    return true;
  };

  useEffect(() => {
    if (!editingEvent || !("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      const status = await getMicrosoft365ConnectionStatus();
      if (!status.connected) return;
      const remoteCategories = await listMicrosoft365MasterCategories();
      if (cancelled || remoteCategories.length === 0) return;
      setCategories((current) => {
        const byName = new Map<string, CalendarCategory>();
        for (const category of current.map(normalizeCategory).filter((entry) => entry.name)) {
          byName.set(category.name.toLowerCase(), category);
        }
        for (const category of remoteCategories.map(normalizeCategory).filter((entry) => entry.name)) {
          byName.set(category.name.toLowerCase(), category);
        }
        const next = Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name, "de"));
        localStorage.setItem(calendarCategoriesStorageKey, JSON.stringify(next));
        return next;
      });
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [editingEvent?.id, editingIsNew]);

  const reviewExactDuplicates = async () => {
    setMessage("Kalender wird auf Duplikate geprüft …");
    try {
      const allEvents = "__TAURI_INTERNALS__" in window ? await listCalendarEvents() : events;
      const groups = findExactCalendarDuplicateGroups(allEvents);
      duplicateReviewEventsRef.current = allEvents;
      setExactDuplicateGroups(groups);
      setMessage("");
      if (groups.length === 0) {
        setActionResult({
          title: "Duplikate geprüft",
          summary: "Es wurden keine Termine mit gleichem Titel, Datum und Beginn gefunden.",
          tone: "success"
        });
        return;
      }
      setShowDuplicateDialog(true);
    } catch (error) {
      setMessage("");
      setActionResult({ title: "Duplikate konnten nicht geprüft werden", summary: String(error), tone: "error" });
    }
  };

  const cleanupExactDuplicates = async () => {
    const result = removeExactCalendarDuplicates(duplicateReviewEventsRef.current);
    if (result.removedEvents.length === 0) {
      setShowDuplicateDialog(false);
      setMessage("Keine doppelten Termine gefunden.");
      return;
    }

    const previousBackup = readDuplicateCleanupBackup();
    const backup: CalendarDuplicateCleanupBackup = {
      createdAt: previousBackup?.createdAt ?? new Date().toISOString(),
      removedEventIds: Array.from(new Set([...(previousBackup?.removedEventIds ?? []), ...result.removedEvents.map((event) => event.id)]))
    };
    try {
      if ("__TAURI_INTERNALS__" in window) {
        await moveCalendarEventsToTrash(result.removedEvents.map((event) => event.id));
        await loadVisibleEvents();
        window.dispatchEvent(new Event(calendarChangedEventName));
      } else {
        persist(result.events);
      }
    } catch (error) {
      setActionResult({ title: "Duplikate nicht entfernt", summary: String(error), tone: "error" });
      return;
    }
    localStorage.setItem(duplicateCleanupBackupKey, JSON.stringify(backup));
    setDuplicateCleanupBackup(backup);
    setShowDuplicateDialog(false);
    setActionResult({
      title: "Duplikate entfernt",
      summary: `${result.removedEvents.length} überzählige ${result.removedEvents.length === 1 ? "Kopie wurde" : "Kopien wurden"} entfernt.`,
      details: [
        "Je Termin bleibt immer eine Kopie erhalten.",
        "Die entfernten Kopien sind gesichert und können über „Bereinigung rückgängig“ wiederhergestellt werden.",
        ...(result.removedEvents.length > 500 ? ["Aus Leistungsgründen zeigt diese Liste die ersten 500 Einträge. Im Papierkorb sind alle Kopien vollständig vorhanden."] : [])
      ],
      items: result.removedEvents.slice(0, 500).map((event) => ({ label: event.title || "Ohne Titel", detail: formatCalendarDate(event.startsAt) })),
      itemsLabel: `${Math.min(500, result.removedEvents.length)} von ${result.removedEvents.length} entfernten Kopien anzeigen`,
      tone: "success"
    });
  };

  const undoDuplicateCleanup = async () => {
    const backup = readDuplicateCleanupBackup();
    if (!backup?.removedEventIds.length) {
      setDuplicateCleanupBackup(null);
      setMessage("Keine frühere Duplikatbereinigung zum Wiederherstellen vorhanden.");
      return;
    }
    if (!window.confirm(`${backup.removedEventIds.length} zuvor entfernte Kalenderkopien wiederherstellen?`)) return;

    try {
      if ("__TAURI_INTERNALS__" in window) {
        await restoreCalendarEvents(backup.removedEventIds);
        await loadVisibleEvents();
        window.dispatchEvent(new Event(calendarChangedEventName));
      }
    } catch (error) {
      setActionResult({ title: "Bereinigung konnte nicht rückgängig gemacht werden", summary: String(error), tone: "error" });
      return;
    }
    localStorage.removeItem(duplicateCleanupBackupKey);
    setDuplicateCleanupBackup(null);
    setActionResult({
      title: "Bereinigung rückgängig gemacht",
      summary: `${backup.removedEventIds.length} ${backup.removedEventIds.length === 1 ? "Kalenderkopie wurde" : "Kalenderkopien wurden"} wiederhergestellt.`,
      details: ["Bestehende Termine wurden dabei nicht überschrieben."],
      tone: "success"
    });
  };

  const createCategory = async (category: CalendarCategory): Promise<string> => {
    const name = category.name.trim();
    if (!name || name.length > 255) throw new Error("Bitte geben Sie einen Namen mit höchstens 255 Zeichen ein.");
    if (categories.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) throw new Error("Diese Kategorie gibt es bereits.");
    setCategorySaving(true);
    try {
      const synced = await syncCategoryWithExchange({ name, color: category.color });
      const rules = "__TAURI_INTERNALS__" in window ? await getCalendarCategoryRules() :
        (JSON.parse(localStorage.getItem(calendarCategoryRulesStorageKey) ?? "[]") as CalendarCategoryOperation[])
          .map((rule) => ({ ...rule, names: rule.names.filter((old) => old.toLowerCase() !== name.toLowerCase()) }));
      localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify(rules));
      persistCategories([...categories, { name, color: category.color }]);
      if (synced) setCategoryExchangeNames((current) => [...current, name]);
      return synced ? `Kategorie „${name}“ wurde in Exchange bestätigt.` : `Kategorie „${name}“ wurde lokal erstellt.`;
    } finally { setCategorySaving(false); }
  };

  const updateCategoryColor = async (category: CalendarCategory, color: string): Promise<string> => {
    const updated = { ...category, color };
    setCategorySaving(true);
    try {
      const synced = await syncCategoryWithExchange(updated);
      if (!synced) {
        const allEvents = "__TAURI_INTERNALS__" in window ? await listCalendarEvents() : JSON.parse(localStorage.getItem(calendarStorageKey) ?? "[]") as CalendarEvent[];
        const changed = allEvents.filter((event) => event.category.toLowerCase() === category.name.toLowerCase()).map((event) => ({ ...event, color }));
        await persistEventChanges(changed);
      }
      persistCategories(categories.map((entry) => entry.name.toLowerCase() === category.name.toLowerCase() ? updated : entry));
      if (synced) setCategoryExchangeNames((current) => Array.from(new Set([...current, category.name])));
      return synced ? `Die Farbe von „${category.name}“ wurde in Exchange bestätigt.` : `Die Farbe von „${category.name}“ wurde lokal gespeichert.`;
    } finally { setCategorySaving(false); }
  };

  const changeCategories = async (operation: CalendarCategoryOperation): Promise<string> => {
    const replacement = operation.replacement ? { ...operation.replacement, name: operation.replacement.name.trim() } : null;
    if (replacement && !categoryPending && categories.some((category) => category.name.toLowerCase() === replacement.name.toLowerCase())) throw new Error("Diese Kategorie gibt es bereits.");
    setCategorySaving(true);
    try {
      let localEvents = 0;
      let exchangeEvents = 0;
      const request = { ...operation, replacement };
      if ("__TAURI_INTERNALS__" in window) {
        const result = await changeCalendarCategories(request);
        localEvents = result.localEvents;
        exchangeEvents = result.exchangeEvents;
        const rules = await getCalendarCategoryRules();
        localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify(rules));
      } else {
        const allEvents = JSON.parse(localStorage.getItem(calendarStorageKey) ?? "[]") as CalendarEvent[];
        const changed = allEvents.filter((event) => operation.names.some((name) => name.toLowerCase() === event.category.toLowerCase()) || (!replacement && !event.category && event.color !== defaultCalendarColor)).map((event) => ({ ...event, category: replacement?.name ?? "", color: replacement?.color ?? defaultCalendarColor }));
        localEvents = changed.length;
        await persistEventChanges(changed);
        const rules = JSON.parse(localStorage.getItem(calendarCategoryRulesStorageKey) ?? "[]") as CalendarCategoryOperation[];
        localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify([...rules, request]));
      }
      persistCategories(applyCalendarCategoryRules(categories));
      if (replacement) mergeRemoteCategories([replacement]);
      setCategoryPending(null);
      await loadVisibleEvents();
      window.dispatchEvent(new Event(calendarStorageUpdatedEventName));
      await openCategoryManager();
      return `${operation.names.length} ${replacement ? "Kategorie umbenannt" : "Kategorien gelöscht"}. ${localEvents} Termine in der App${operation.exchange ? ` und ${exchangeEvents} in Exchange aktualisiert` : " aktualisiert"}.`;
    } catch (error) {
      if ("__TAURI_INTERNALS__" in window) setCategoryPending(await getCalendarCategoryOperation().catch(() => null));
      throw error;
    } finally { setCategorySaving(false); }
  };

  const repairExchangeCategoryColors = async () => {
    setCategoryRepairing(true);
    try {
      if (await getMicrosoft365ReadOnlyTestMode()) {
        setActionResult({
          title: "Microsoft-365-Testmodus: nur lesen",
          summary: "Diese App darf keine Exchange-Farben ändern. Öffnen Sie die verbundene Admin-Test-App ohne „NUR LESEN“, um die Farben zu reparieren.",
          tone: "info"
        });
        return;
      }
      const preview = await previewMicrosoft365CalendarCategoryRepair();
      if (preview.linkedEvents === 0) {
        setActionResult({
          title: "Keine verknüpften Exchange-Termine gefunden",
          summary: "Es gibt derzeit keine bereits verknüpften Termine, deren Kategorien isoliert repariert werden können.",
          tone: "info"
        });
        return;
      }
      const categorySummary = preview.categoryNames.length > 0
        ? `\n\nBetroffene Kategorien: ${preview.categoryNames.join(", ")}`
        : "";
      const confirmed = window.confirm(
        `${preview.linkedEvents} bereits verknüpfte Exchange-Termine werden geprüft.\n` +
        `${preview.categoriesToRepair} Master-Kategorien müssen angelegt oder farblich korrigiert werden.\n\n` +
        `Die normale Warteschlange mit ${preview.pendingOperations} Vorgängen, darunter ${preview.pendingDeletions} Löschungen, wird NICHT ausgeführt oder verändert.` +
        `${categorySummary}\n\nJetzt ausschließlich Kategorien und Farben reparieren?`
      );
      if (!confirmed) return;

      const result = await repairMicrosoft365CalendarCategories();
      if (result.errors === 0) {
        mergeRemoteCategories(await listMicrosoft365MasterCategories());
      }
      setActionResult({
        title: result.errors === 0 ? "Kategorien in Exchange bestätigt" : "Exchange-Kategorien teilweise bestätigt",
        summary: `Exchange hat die gespeicherte Kategorie bei ${result.updated} von ${result.scanned} erneut gelesenen Terminen bestätigt.`,
        details: [
          `Die ${preview.pendingOperations} ausstehenden Synchronisierungsvorgänge wurden nicht ausgeführt oder verändert.`,
          "Titel, Uhrzeit, Teilnehmer und Inhalte der Termine blieben unverändert.",
          "Falls Teams weiterhin Grau zeigt, laden Sie den Kalender neu und prüfen Sie die Kategorie desselben Termins in Outlook.",
          ...result.errorMessages
        ],
        tone: result.errors === 0 ? "success" : "error"
      });
    } catch (error) {
      setActionResult({
        title: "Exchange-Farben konnten nicht repariert werden",
        summary: String(error),
        details: ["Falls die Berechtigung für Kategorien fehlt, verbinden Sie Microsoft 365 einmal neu und versuchen Sie es erneut."],
        tone: "error"
      });
    } finally {
      setCategoryRepairing(false);
    }
  };

  const openNewEvent = (date = new Date(), exactTime = false) => {
    const starts = new Date(date);
    if (!exactTime) {
      const now = new Date();
      starts.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }
    setEditingEvent(blankEvent(starts));
    setEditingIsNew(true);
  };

  const openNewEventRange = (starts: Date, ends: Date) => {
    setEditingEvent({ ...blankEvent(starts), endsAt: toLocalDateTime(ends.toISOString()) });
    setEditingIsNew(true);
  };

  const navigateCalendar = (direction: -1 | 1) => {
    if (view === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
      return;
    }
    setCursor(addDays(cursor, direction * (view === "week" || view === "workweek" ? 7 : 1)));
  };

  const updateAdvancedSettings = (next: Partial<AdvancedCalendarSettings>) => {
    setAdvancedSettings((current) => ({ ...current, ...next }));
  };

  const setSourceVisible = (source: string, visible: boolean) => {
    setAdvancedSettings((current) => ({
      ...current,
      hiddenSources: visible
        ? current.hiddenSources.filter((entry) => entry !== source)
        : [...new Set([...current.hiddenSources, source])]
    }));
  };

  const minutesFromPointer = (element: HTMLElement, clientY: number) => {
    const rect = element.getBoundingClientRect();
    const hourHeight = advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight;
    const rawMinutes = ((clientY - rect.top) / hourHeight) * 60;
    return Math.min(23 * 60 + 45, safeCalendarMinutes(rawMinutes));
  };

  const setActiveTimeSelection = (selection: CalendarTimeSelection | null) => {
    timeSelectionRef.current = selection;
    setTimeSelection(selection);
  };

  const beginTimeSelection = (day: Date, event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (event.button !== 0 || (target instanceof Element && target.closest(".calendar-week-timed-event"))) return;
    event.preventDefault();
    const minutes = minutesFromPointer(event.currentTarget, event.clientY);
    setActiveTimeSelection({ dayKey: dateInputValue(day), anchorMinutes: minutes, currentMinutes: minutes });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some embedded webviews can finish the selection without pointer capture.
    }
  };

  const updateTimeSelection = (day: Date, event: ReactPointerEvent<HTMLDivElement>) => {
    const current = timeSelectionRef.current;
    if (!current || current.dayKey !== dateInputValue(day) || event.buttons !== 1) return;
    setActiveTimeSelection({
      ...current,
      currentMinutes: minutesFromPointer(event.currentTarget, event.clientY)
    });
  };

  const finishTimeSelection = (day: Date, event: ReactPointerEvent<HTMLDivElement>) => {
    const current = timeSelectionRef.current;
    if (!current || current.dayKey !== dateInputValue(day)) return;
    const completed = {
      ...current,
      currentMinutes: minutesFromPointer(event.currentTarget, event.clientY)
    };
    const { startMinutes, endMinutes } = calendarTimeSelectionBounds(completed);
    const starts = startOfDay(day);
    const ends = startOfDay(day);
    starts.setMinutes(startMinutes);
    ends.setMinutes(endMinutes);
    setActiveTimeSelection(null);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the embedded webview.
    }
    openNewEventRange(starts, ends);
  };

  const finishEventDrag = () => {
    draggedEventIdRef.current = null;
    setDraggedEventId(null);
    setEventDropPreview(null);
  };

  const persistMovedEvent = (id: string, nextStart: Date) => {
    const existing = events.find((entry) => entry.id === id);
    if (!existing || existing.recurrence) return;
    const oldStart = eventDate(existing);
    const oldEnd = eventEndDate(existing);
    if (!oldStart || !oldEnd) return;
    const duration = Math.max(15 * 60_000, oldEnd.getTime() - oldStart.getTime());
    const nextEnd = new Date(nextStart.getTime() + duration);
    persistSingleEvent({
      ...existing,
      startsAt: toLocalDateTime(nextStart.toISOString()),
      endsAt: toLocalDateTime(nextEnd.toISOString()),
      updatedAt: new Date().toISOString()
    });
  };

  const beginEventPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, eventId: string) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    suppressEventClickRef.current = null;
    const existing = events.find((entry) => entry.id === eventId);
    const starts = existing ? eventDate(existing) : null;
    const ends = existing ? eventEndDate(existing) : null;
    const durationMinutes = starts && ends ? Math.max(15, (ends.getTime() - starts.getTime()) / 60_000) : 15;
    const eventRect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.max(0, Math.min(1, (event.clientY - eventRect.top) / Math.max(1, eventRect.height)));
    eventPointerDragRef.current = {
      eventId,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetMinutes: pointerRatio * durationMinutes,
      dragging: false
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The WebView can still deliver the pointer-up event without capture.
    }
  };

  const dropPreviewFromPointer = (current: CalendarEventPointerDrag, clientX: number, clientY: number): CalendarEventDropPreview | null => {
    const dropTarget = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-calendar-drop-kind][data-calendar-day]");
    const day = dropTarget?.dataset.calendarDay ? dateFromInput(dropTarget.dataset.calendarDay) : null;
    const existing = events.find((entry) => entry.id === current.eventId);
    const oldStart = existing ? eventDate(existing) : null;
    const oldEnd = existing ? eventEndDate(existing) : null;
    if (!dropTarget || !day || !existing || !oldStart || !oldEnd) return null;

    const kind = dropTarget.dataset.calendarDropKind === "time" ? "time" : "day";
    const nextStart = startOfDay(day);
    if (kind === "time") {
      const startMinutes = Math.min(23 * 60 + 45, safeCalendarMinutes(minutesFromPointer(dropTarget, clientY) - current.offsetMinutes));
      nextStart.setMinutes(startMinutes);
    } else {
      nextStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
    }
    const duration = Math.max(15 * 60_000, oldEnd.getTime() - oldStart.getTime());
    const nextEnd = new Date(nextStart.getTime() + duration);
    return {
      event: {
        ...existing,
        startsAt: toLocalDateTime(nextStart.toISOString()),
        endsAt: toLocalDateTime(nextEnd.toISOString())
      },
      dayKey: dateInputValue(day),
      kind
    };
  };

  const updateEventPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = eventPointerDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!current.dragging && Math.hypot(event.clientX - current.originX, event.clientY - current.originY) < 6) return;
    event.preventDefault();
    if (!current.dragging) {
      current.dragging = true;
      draggedEventIdRef.current = current.eventId;
      setDraggedEventId(current.eventId);
    }
    setEventDropPreview(dropPreviewFromPointer(current, event.clientX, event.clientY));
  };

  const finishEventPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = eventPointerDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    eventPointerDragRef.current = null;

    if (current.dragging) {
      event.preventDefault();
      suppressEventClickRef.current = current.eventId;
      const preview = dropPreviewFromPointer(current, event.clientX, event.clientY);
      const nextStart = preview ? eventDate(preview.event) : null;
      if (nextStart) persistMovedEvent(current.eventId, nextStart);
    }

    finishEventDrag();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already have ended.
    }
  };

  const cancelEventPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = eventPointerDragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragging) suppressEventClickRef.current = current.eventId;
    eventPointerDragRef.current = null;
    finishEventDrag();
  };

  const openEventFromClick = (event: ReactMouseEvent<HTMLButtonElement>, calendarEvent: CalendarEvent) => {
    event.stopPropagation();
    if (suppressEventClickRef.current === calendarEvent.id) {
      suppressEventClickRef.current = null;
      event.preventDefault();
      return;
    }
    openEvent(calendarEvent);
  };

  const finishMonthSelection = (endIndex: number) => {
    if (!monthSelection) return;
    const firstIndex = Math.min(monthSelection.anchorIndex, endIndex);
    const lastIndex = Math.max(monthSelection.anchorIndex, endIndex);
    setMonthSelection(null);
    if (firstIndex === lastIndex) {
      openNewEvent(monthDays[firstIndex]);
      return;
    }
    const starts = startOfDay(monthDays[firstIndex]);
    const ends = startOfDay(addDays(monthDays[lastIndex], 1));
    setEditingEvent({ ...blankEvent(starts), startsAt: toLocalDateTime(starts.toISOString()), endsAt: toLocalDateTime(ends.toISOString()), isAllDay: true });
    setEditingIsNew(true);
  };

  const openEvent = (event: CalendarEvent) => {
    const master = event.recurrenceMasterId ? events.find((entry) => entry.id === event.recurrenceMasterId) ?? event : event;
    setEditingEvent({ ...normalizeEvent(master), startsAt: toLocalDateTime(master.startsAt), endsAt: toLocalDateTime(master.endsAt) });
    setEditingIsNew(false);
  };

  const openEventContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, calendarEvent: CalendarEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 258;
    const menuHeight = 480;
    setEventContextMenu({
      event: calendarEvent,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      submenu: null
    });
  };

  const contextMenuMaster = (event: CalendarEvent) => event.recurrenceMasterId
    ? events.find((entry) => entry.id === event.recurrenceMasterId) ?? event
    : event;

  const updateContextMenuEvent = (event: CalendarEvent, update: Partial<CalendarEvent>) => {
    const current = normalizeEvent(contextMenuMaster(event));
    const currentMeeting = current.meeting ?? blankEvent().meeting!;
    const nextMeeting = update.meeting ? { ...currentMeeting, ...update.meeting } : currentMeeting;
    const updatedCategory = update.category;
    const matchingCategory = typeof updatedCategory === "string"
      ? categories.find((category) => category.name === updatedCategory.trim())
      : undefined;
    persistSingleEvent({
      ...current,
      ...update,
      // Exchange represents event colours through categories. A direct colour
      // selection must assign its colour category instead of retaining an old
      // custom category whose mailbox colour would override the selection.
      category: update.color !== undefined && update.category === undefined ? "" : update.category ?? current.category,
      meeting: nextMeeting,
      color: matchingCategory?.color ?? update.color ?? current.color,
      updatedAt: new Date().toISOString()
    });
    setEventContextMenu(null);
  };

  const duplicateContextMenuEvent = (event: CalendarEvent) => {
    const source = normalizeEvent(contextMenuMaster(event));
    setEditingEvent({
      ...source,
      id: crypto.randomUUID(),
      title: source.title ? `${source.title} (Kopie)` : "Kopie",
      updatedAt: new Date().toISOString(),
      recurrence: null,
      recurrenceMasterId: undefined,
      recurrenceId: undefined,
      excludedDates: [],
      meeting: { ...source.meeting!, onlineMeetingUrl: "" }
    });
    setEditingIsNew(true);
    setEventContextMenu(null);
  };

  const forwardContextMenuEvent = async (event: CalendarEvent) => {
    const target = contextMenuMaster(event);
    const body = [
      `Termin: ${target.title || "Ohne Titel"}`,
      `Zeit: ${formatCalendarDate(target.startsAt)}${target.isAllDay ? " (ganztägig)" : ` · ${eventTimeRange(target)}`}`,
      target.location ? `Ort: ${target.location}` : "",
      target.description ? `\n${target.description}` : ""
    ].filter(Boolean).join("\n");
    const mailto = `mailto:?subject=${encodeURIComponent(`WG: ${target.title || "Termin"}`)}&body=${encodeURIComponent(body)}`;
    try {
      if ("__TAURI_INTERNALS__" in window) await openUrl(mailto);
      else window.location.href = mailto;
      setMessage("E-Mail-Programm zum Weiterleiten geöffnet.");
    } catch {
      setMessage("Das E-Mail-Programm konnte nicht geöffnet werden.");
    } finally {
      setEventContextMenu(null);
    }
  };

  const exportContextMenuEvent = async (event: CalendarEvent) => {
    const target = contextMenuMaster(event);
    const safeName = (target.title || "Termin").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "Termin";
    try {
      if ("__TAURI_INTERNALS__" in window) {
        const path = await save({ defaultPath: `${safeName}.ics`, filters: [{ name: "ICS", extensions: ["ics"] }] });
        if (!path) return;
        await writeExportFile(path, exportCalendarIcs([target]));
      } else {
        const url = URL.createObjectURL(new Blob([exportCalendarIcs([target])], { type: "text/calendar;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${safeName}.ics`;
        link.click();
        URL.revokeObjectURL(url);
      }
      setActionResult({ title: "Termin als ICS gespeichert", summary: `„${target.title || "Ohne Titel"}“ kann jetzt in einem Kalenderprogramm importiert werden.`, tone: "success" });
    } catch (error) {
      setActionResult({ title: "ICS-Datei konnte nicht erstellt werden", summary: String(error), tone: "error" });
    } finally {
      setEventContextMenu(null);
    }
  };

  const saveEvent = async () => {
    if (!editingEvent) return;
    const targetId = editingEvent.calendarSourceId ?? destinationCalendars.find((calendar) => editingEvent.id.startsWith(`m365:${calendar.id}:`))?.id;
    const target = destinationCalendars.find((calendar) => calendar.id === targetId);
    if (target && "__TAURI_INTERNALS__" in window) {
      try {
        const config = parseSyncConfig(await getAppSetting(synchronizationConfigKey));
        if (!target.editable || (config.sourceDirections[target.id] ?? config.direction) === "import") throw new Error("Dieser Kalender erlaubt keine Änderungen. Bitte einen beschreibbaren Kalender mit ausgehender Synchronisierung wählen.");
        if (!config.selectedCalendarSourceIds.includes(target.id)) {
          await setAppSetting(synchronizationConfigKey, JSON.stringify({
            ...config,
            selectedCalendarSourceIds: [...config.selectedCalendarSourceIds, target.id],
            sourceDirections: { ...config.sourceDirections, [target.id]: config.sourceDirections[target.id] ?? "bidirectional" },
            sharedCalendars: config.sharedCalendars || target.shared
          }));
        }
      } catch (error) {
        setDestinationsError(String(error));
        return;
      }
    }
    const matchingCategory = categories.find((category) => category.name === editingEvent.category.trim());
    persistSingleEvent({ ...editingEvent, updatedAt: new Date().toISOString(), color: matchingCategory?.color ?? editingEvent.color, source: editingEvent.source || "DMH Backup" });
    const date = eventDate(editingEvent);
    if (date) setCursor(startOfDay(date));
    setEditingEvent(null);
  };

  const deleteEvent = (event = editingEvent) => {
    if (!event) return;
    const master = event.recurrenceMasterId ? events.find((entry) => entry.id === event.recurrenceMasterId) ?? event : event;
    const objectName = master.recurrence ? `Terminserie "${master.title}"` : `Termin "${master.title}"`;
    if (!window.confirm(`${objectName} wirklich löschen?`)) return;
    persistRemovedEvent(master.id);
    setEditingEvent(null);
    setActionResult({
      title: master.recurrence ? "Terminserie in den Papierkorb verschoben" : "Termin in den Papierkorb verschoben",
      summary: `„${master.title}“ kann im Papierkorb wiederhergestellt werden.`,
      items: [{ label: master.title, detail: formatCalendarDate(master.startsAt) }],
      itemsLabel: "Betroffenen Termin anzeigen",
      tone: "success"
    });
  };

  const deleteAllEvents = async () => {
    if (totalCalendarEvents === 0) return;
    try {
      const allEvents = "__TAURI_INTERNALS__" in window ? await listCalendarEvents() : events;
      if (!window.confirm(`Alle ${allEvents.length} Termine und Terminserien in den Papierkorb verschieben?`)) return;
      const movedEvents = allEvents.map(normalizeEvent);
      if ("__TAURI_INTERNALS__" in window) {
        await moveCalendarEventsToTrash(movedEvents.map((event) => event.id));
        await loadVisibleEvents();
        window.dispatchEvent(new Event(calendarChangedEventName));
      } else {
        persist([]);
      }
      setTotalCalendarEvents(0);
      setEditingEvent(null);
      setActionResult({
        title: "Termine in den Papierkorb verschoben",
        summary: `${movedEvents.length} Termine und Serien können im Papierkorb wiederhergestellt werden.`,
        details: movedEvents.length > 100 ? ["Aus Leistungsgründen zeigt diese Liste die ersten 100 Einträge. Im Papierkorb sind alle Termine vollständig vorhanden."] : undefined,
        items: movedEvents.slice(0, 100).map((event) => ({ label: event.title || "Ohne Titel", detail: formatCalendarDate(event.startsAt) })),
        itemsLabel: `${Math.min(100, movedEvents.length)} von ${movedEvents.length} verschobenen Terminen anzeigen`,
        tone: "success"
      });
    } catch (error) {
      setActionResult({ title: "Termine konnten nicht gelöscht werden", summary: String(error), tone: "error" });
    }
  };

  const openReconciliation = async () => {
    setMessage("Kalenderdaten werden für den Vergleich vorbereitet …");
    try {
      const allEvents = "__TAURI_INTERNALS__" in window ? await listCalendarEvents() : events;
      setReconciliationEvents(allEvents.map(normalizeEvent));
      setMessage("");
      setReconciliationOpen(true);
    } catch (error) {
      setMessage("");
      setActionResult({ title: "Kalendervergleich konnte nicht geöffnet werden", summary: String(error), tone: "error" });
    }
  };

  return (
    <div className={`page calendar-page${calendarLoaded && totalCalendarEvents === 0 ? " calendar-empty" : ""}`}>
      <header className="page-header">
        <div>
          <h2>Kalender</h2>
          <p>Termine übersichtlich planen und verwalten.</p>
        </div>
        <div className="calendar-header-actions">
          <button className="primary" type="button" onClick={() => openNewEvent()}>
            <Plus size={20} /> {advancedMode ? "Neue Besprechung" : "Neuer Termin"}
          </button>
          <div className="calendar-actions-menu-wrap">
            <button className="icon-only" type="button" aria-label="Weitere Kalenderaktionen" title="Weitere Aktionen" aria-haspopup="menu" aria-expanded={showActionsMenu} onClick={() => setShowActionsMenu((open) => !open)}>
              <MoreHorizontal size={21} />
            </button>
            {showActionsMenu && <div className="calendar-actions-menu" role="menu">
              <button type="button" onClick={() => { setShowActionsMenu(false); setM365SyncDialogOpen(true); }}>
                <RefreshCw size={18} /> Microsoft 365 / Exchange verwalten
              </button>
              <span className="calendar-actions-separator" />
              <button type="button" onClick={() => { setShowActionsMenu(false); onNavigate("import"); }}><Upload size={18} /> Termine importieren</button>
              <button type="button" onClick={() => { setShowActionsMenu(false); onNavigate("export"); }}><Download size={18} /> Termine exportieren</button>
              <button type="button" onClick={() => { setShowActionsMenu(false); void openReconciliation(); }}><RefreshCw size={18} /> Kalender erneut abgleichen</button>
              <button type="button" onClick={() => void openCategoryManager()}><Tag size={18} /> Kategorien verwalten</button>
              <button type="button" onClick={() => { setShowActionsMenu(false); reviewExactDuplicates(); }}><ListChecks size={18} /> Duplikate prüfen</button>
              {duplicateCleanupBackup && <button type="button" onClick={() => { setShowActionsMenu(false); undoDuplicateCleanup(); }}><Undo2 size={18} /> Bereinigung rückgängig</button>}
              <span className="calendar-actions-separator" />
              <button type="button" onClick={() => { setShowActionsMenu(false); onAdvancedModeChange(!advancedMode); }}>
                <Settings2 size={18} /> {advancedMode ? "Einfacher Kalender" : "Kalender erweitert"}
              </button>
              <span className="calendar-actions-separator" />
              <button className="danger" type="button" onClick={() => { setShowActionsMenu(false); void deleteAllEvents(); }} disabled={totalCalendarEvents === 0}><Trash2 size={18} /> Alle Termine löschen</button>
            </div>}
          </div>
        </div>
      </header>
      <StatusMessage message={actionResult ? "" : message} />

      <ActionResultDialog result={actionResult} onClose={() => setActionResult(null)} />

      {m365SyncDialogOpen && <Microsoft365SyncDialog context="calendar" onClose={() => setM365SyncDialogOpen(false)} />}

      {showCategoryDialog && <CalendarCategoryManager
        categories={categories} exchangeNames={categoryExchangeNames} counts={categoryCounts}
        connected={categoryConnected} loading={categoryManagerLoading} busy={categorySaving}
        readOnly={categoryReadOnly} repairing={categoryRepairing} loadError={categoryLoadError}
        pending={categoryPending} onRefresh={openCategoryManager} onCreate={createCategory}
        onColor={updateCategoryColor} onChange={changeCategories} onRepair={repairExchangeCategoryColors}
        onClose={() => setShowCategoryDialog(false)}
      />}

      {showDuplicateDialog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calendar-duplicate-title">
          <div className="modal-card calendar-duplicate-dialog">
            <section className="form-panel">
              <div className="panel-heading">
                <div>
                  <h3 id="calendar-duplicate-title">Kalenderduplikate</h3>
                  <p>{exactDuplicateCopies} überzählige {exactDuplicateCopies === 1 ? "Kopie" : "Kopien"} in {exactDuplicateGroups.length} {exactDuplicateGroups.length === 1 ? "Gruppe" : "Gruppen"} gefunden.</p>
                </div>
                <button className="icon-only" type="button" aria-label="Schließen" onClick={() => setShowDuplicateDialog(false)}>
                  <X size={22} />
                </button>
              </div>

              <div className="calendar-duplicate-safety" role="note">
                Als Duplikat gilt ein Termin nur, wenn Titel, Datum und Startzeit gleich sind. Sobald eines dieser drei Merkmale abweicht, bleiben beide Termine erhalten.
              </div>

              <ul className="calendar-duplicate-list">
                {exactDuplicateGroups.slice(0, 10).map((group) => (
                  <li key={`${group.event.id}-${group.copies}`}>
                    <strong>{group.event.title}</strong>
                    <span>{formatCalendarDate(group.event.startsAt)} · {group.copies} Kopien</span>
                    {group.event.source && <small>{group.event.source}</small>}
                  </li>
                ))}
              </ul>
              {exactDuplicateGroups.length > 10 && <p>Weitere {exactDuplicateGroups.length - 10} Gruppen werden nach derselben Regel behandelt.</p>}

              <div className="button-row">
                <button type="button" onClick={() => setShowDuplicateDialog(false)}>Abbrechen</button>
                <button className="danger-button" type="button" onClick={cleanupExactDuplicates}>
                  <Trash2 size={18} /> {exactDuplicateCopies} überzählige {exactDuplicateCopies === 1 ? "Kopie" : "Kopien"} entfernen
                </button>
              </div>
              <p className="calendar-duplicate-backup-note">Vor dem Entfernen werden sämtliche Kopien vollständig lokal gesichert und können über „Bereinigung rückgängig“ wiederhergestellt werden.</p>
            </section>
          </div>
        </div>
      )}

      {editingEvent && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={editingIsNew ? "Neue Besprechung" : "Besprechung bearbeiten"}>
          <div className="modal-card calendar-event-dialog">
            <CalendarEventForm
              value={editingEvent}
              isNew={editingIsNew}
              categories={categories}
              events={events}
              calendars={calendarDestinations}
              calendarsLoading={destinationsLoading}
              calendarsError={destinationsError}
              onChange={setEditingEvent}
              onSave={saveEvent}
              onDelete={() => deleteEvent()}
              onCancel={() => setEditingEvent(null)}
            />
          </div>
        </div>
      )}

      {!calendarLoaded ? (
        <div className="page-loading">Kalender wird geladen …</div>
      ) : totalCalendarEvents === 0 ? (
        <div className="empty-import-screen">
          <EmptyImportState kind="calendar" onEasyImport={() => setEasyImportOpen(true)} onManualImport={() => onNavigate("calendar-import")} />
        </div>
      ) : <section className={advancedMode ? "calendar-shell advanced-calendar-shell" : "calendar-shell"}>
        {advancedMode && (
          <aside className="advanced-calendar-navigation" aria-label="Erweiterte Kalendernavigation">
            <div className="advanced-calendar-navigation-heading">
              <div><span>Kalender</span><strong>Planung</strong></div>
              <PanelLeftClose size={19} aria-hidden="true" />
            </div>
            <div className="advanced-mini-month" role="grid" aria-label="Monatsübersicht">
              {weekdays.map((day) => <span key={day}>{day[0]}</span>)}
              {monthDays.map((day) => (
                <button
                  className={`${day.getMonth() !== cursor.getMonth() ? "outside" : ""}${sameDay(day, cursor) ? " selected" : ""}${sameDay(day, new Date()) ? " today" : ""}`}
                  key={day.toISOString()}
                  type="button"
                  onClick={() => { setCursor(day); setView("day"); }}
                >{day.getDate()}</button>
              ))}
            </div>
            <div className="advanced-calendar-source-list">
              <div><strong>Meine Kalender</strong><button type="button" onClick={() => updateAdvancedSettings({ hiddenSources: [] })}>Alle</button></div>
              <label><input checked={advancedSettings.hiddenSources.length === 0} type="checkbox" onChange={(event) => updateAdvancedSettings({ hiddenSources: event.target.checked ? [] : calendarSources })} /> Alle Termine</label>
              {calendarSources.map((source) => (
                <label key={source}><input checked={!advancedSettings.hiddenSources.includes(source)} type="checkbox" onChange={(event) => setSourceVisible(source, event.target.checked)} /> {source}</label>
              ))}
            </div>
          </aside>
        )}
        <div className={advancedMode ? "advanced-calendar-workspace" : undefined}>
        <section className={advancedMode ? "calendar-toolbar advanced-calendar-toolbar" : "calendar-toolbar"} aria-label="Kalendersteuerung">
          <div className="calendar-toolbar-navigation">
            <button type="button" onClick={() => setCursor(startOfDay(new Date()))}>Heute</button>
            <button className="icon-only" type="button" aria-label="Vorheriger Zeitraum" title="Zurück" onClick={() => navigateCalendar(-1)}><ChevronLeft size={20} /></button>
            <button className="icon-only" type="button" aria-label="Nächster Zeitraum" title="Weiter" onClick={() => navigateCalendar(1)}><ChevronRight size={20} /></button>
            <h3>{title}</h3>
          </div>
          <div className="calendar-toolbar-controls">
            {!advancedMode && <label className="calendar-toolbar-field">
              <CalendarDays size={18} aria-hidden="true" />
              <span className="sr-only">Datum</span>
              <input type="date" value={dateInputValue(cursor)} onChange={(event) => { const nextDate = dateFromInput(event.target.value); if (nextDate) setCursor(nextDate); }} />
            </label>}
            <label className="calendar-toolbar-field">
              <Filter size={18} aria-hidden="true" />
              <span className="sr-only">Termine filtern</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value={allCategoriesValue}>Alle Filter</option>
                {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
              </select>
            </label>
            <label className="calendar-toolbar-field view-field">
              <Rows3 size={18} aria-hidden="true" />
              <span className="sr-only">Kalenderansicht</span>
              <select value={view} onChange={(event) => setView(event.target.value as CalendarView)}>
                <option value="day">Tag</option>
                {advancedMode && <option value="workweek">Arbeitswoche</option>}
                <option value="week">Woche</option>
                <option value="month">Monat</option>
              </select>
            </label>
            {advancedMode && <div className="advanced-calendar-controls">
              <button className={advancedFiltersOpen ? "active" : ""} type="button" aria-expanded={advancedFiltersOpen} onClick={() => setAdvancedFiltersOpen((open) => !open)}><Filter size={18} /> Filter</button>
              <button type="button" onClick={() => openNewEvent(new Date(), true)}><Clock3 size={18} /> Jetzt planen</button>
              {advancedFiltersOpen && <div className="advanced-calendar-filter-popover">
                <label><Clock3 size={17} /> Zeitskala
                  <select value={advancedSettings.hourHeight} onChange={(event) => updateAdvancedSettings({ hourHeight: Number(event.target.value) })}>
                    <option value={52}>Kompakt</option><option value={68}>Standard</option><option value={84}>Groß</option>
                  </select>
                </label>
                <p>Termine lassen sich ziehen. Ziehen im freien Zeitraster erstellt eine neue Besprechung.</p>
              </div>}
            </div>}
          </div>
        </section>

      {view === "month" && (
        <section className="calendar-grid month-view">
          {weekdays.map((day) => <div className="calendar-weekday" key={day}>{day}</div>)}
          {monthDays.map((day, dayIndex) => {
            const dayEvents = eventsForDay(day);
            const monthRangeStart = monthSelection ? Math.min(monthSelection.anchorIndex, monthSelection.currentIndex) : -1;
            const monthRangeEnd = monthSelection ? Math.max(monthSelection.anchorIndex, monthSelection.currentIndex) : -1;
            const classes = [
              "calendar-day",
              day.getMonth() !== cursor.getMonth() ? "outside" : "",
              sameDay(day, new Date()) ? "today" : "",
              dayIndex >= monthRangeStart && dayIndex <= monthRangeEnd ? "range-selected" : "",
              eventDropPreview?.kind === "day" && eventDropPreview.dayKey === dateInputValue(day) ? "drop-preview-active" : "",
              draggedEventId ? "drag-ready" : ""
            ].filter(Boolean).join(" ");
            return (
              <div
                className={classes}
                key={day.toISOString()}
                data-calendar-day={dateInputValue(day)}
                data-calendar-drop-kind="day"
                onPointerDown={(event) => {
                  if (event.button !== 0 || (event.target as HTMLElement).closest(".calendar-event-chip")) return;
                  event.preventDefault();
                  setMonthSelection({ anchorIndex: dayIndex, currentIndex: dayIndex });
                }}
                onPointerEnter={(event) => {
                  if (monthSelection && event.buttons === 1) setMonthSelection((current) => current ? { ...current, currentIndex: dayIndex } : null);
                }}
                onPointerUp={() => finishMonthSelection(dayIndex)}
              >
                <span className="calendar-day-number">{day.getDate()}</span>
                <div className="calendar-day-events">
                  {eventDropPreview?.kind === "day" && eventDropPreview.dayKey === dateInputValue(day) && (
                    <span className="calendar-event-chip calendar-event-drop-preview-chip" style={calendarColorStyle(eventDropPreview.event.color)} aria-hidden="true">
                      <time>{eventTime(eventDropPreview.event)}</time> {eventDropPreview.event.title || "Ohne Titel"}
                    </span>
                  )}
                  {dayEvents.slice(0, 3).map((event) => {
                    const canDrag = !event.recurrenceMasterId && !event.recurrence;
                    return <button
                      className={["calendar-event-chip", canDrag ? "movable" : "", draggedEventId === event.id ? "dragging" : ""].filter(Boolean).join(" ")}
                      style={calendarColorStyle(event.color)}
                      type="button"
                      title={`${calendarEventDisplayTitle(event)} - ${event.location}${canDrag ? "\nZum Verschieben ziehen" : ""}`}
                      key={event.id}
                      onClick={(click) => openEventFromClick(click, event)}
                      onContextMenu={(contextEvent) => openEventContextMenu(contextEvent, event)}
                      onPointerDown={(pointerEvent) => canDrag && beginEventPointerDrag(pointerEvent, event.id)}
                      onPointerMove={(pointerEvent) => canDrag && updateEventPointerDrag(pointerEvent)}
                      onPointerUp={(pointerEvent) => canDrag && finishEventPointerDrag(pointerEvent)}
                      onPointerCancel={(pointerEvent) => canDrag && cancelEventPointerDrag(pointerEvent)}
                    >{event.isAllDay ? <span className="calendar-event-all-day-label">Ganztägig</span> : <time>{eventTime(event)}</time>} {calendarEventDisplayTitle(event)}</button>;
                  })}
                  {dayEvents.length > 3 && <small>+ {dayEvents.length - 3} weitere</small>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {(view === "week" || view === "workweek") && (
        <section className={view === "workweek" ? "calendar-week-schedule workweek" : "calendar-week-schedule"} aria-label={view === "workweek" ? "Kalender für die Arbeitswoche" : "Wochenkalender"} style={{ "--calendar-days": weekDays.length } as CSSProperties}>
          <div className="calendar-week-scroll" ref={timeGridScrollRef}>
            <div className="calendar-week-head">
              <div className="calendar-week-timezone" title="Zeitzone">MEZ</div>
              {weekDays.map((day) => (
                <button className={sameDay(day, new Date()) ? "today" : ""} type="button" key={day.toISOString()} onClick={() => { setCursor(day); setView("day"); }}>
                  <span>{weekdays[(day.getDay() || 7) - 1]}</span>
                  <strong>{day.getDate()}</strong>
                </button>
              ))}
            </div>
            <AllDayEventStrip days={weekDays} events={sortedEvents} onOpen={openEvent} onContextMenu={openEventContextMenu} />
            <div
              className="calendar-week-timeline"
              style={{ "--calendar-days": weekDays.length, "--calendar-hour-height": `${advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight}px`, "--calendar-half-hour-height": `${(advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) / 2}px`, height: `${(advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) * 24}px` } as CSSProperties}
            >
              <div className="calendar-time-axis" aria-hidden="true">
                {calendarHours.map((hour) => <time key={hour} style={{ top: `${hour * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}>{String(hour).padStart(2, "0")}:00</time>)}
              </div>
              <div className="calendar-week-day-tracks">
                {weekDays.map((day, dayIndex) => {
                  const now = currentTime;
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();
                  return (
                    <div
                      className={["calendar-week-day-track", sameDay(day, now) ? "today" : "", eventDropPreview?.kind === "time" && eventDropPreview.dayKey === dateInputValue(day) ? "drop-preview-active" : ""].filter(Boolean).join(" ")}
                      key={day.toISOString()}
                      role="gridcell"
                      aria-label={`${new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(day)}. Freien Zeitraum markieren, um einen Termin zu erstellen.`}
                      data-calendar-day={dateInputValue(day)}
                      data-calendar-drop-kind="time"
                      onPointerDown={(event) => beginTimeSelection(day, event)}
                      onPointerMove={(event) => updateTimeSelection(day, event)}
                      onPointerUp={(event) => finishTimeSelection(day, event)}
                      onPointerCancel={() => setActiveTimeSelection(null)}
                      onLostPointerCapture={() => { if (timeSelectionRef.current) setActiveTimeSelection(null); }}
                    >
                      {sameDay(day, now) && <span className="calendar-current-time-line" style={{ top: `${(nowMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}><i /></span>}
                      {timeSelection?.dayKey === dateInputValue(day) && (() => {
                        const bounds = calendarTimeSelectionBounds(timeSelection);
                        return <span className="calendar-time-selection" style={{ top: `${(bounds.startMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px`, height: `${((bounds.endMinutes - bounds.startMinutes) / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}><strong>{formatTimeSelection(timeSelection)}</strong></span>;
                      })()}
                      {eventDropPreview?.kind === "time" && eventDropPreview.dayKey === dateInputValue(day) && (
                        <span className="calendar-event-drop-preview" style={calendarEventDropPreviewStyle(eventDropPreview.event, advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight, 28)} aria-hidden="true">
                          <strong>{eventDropPreview.event.title || "Ohne Titel"}</strong>
                          <time>{eventTimeRange(eventDropPreview.event)}</time>
                        </span>
                      )}
                      {weekLayouts[dayIndex].map((layout) => {
                        const durationHeight = ((layout.endMinutes - layout.startMinutes) / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight);
                        const eventStyle = {
                          ...calendarColorStyle(layout.event.color),
                          top: `${(layout.startMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) + 1}px`,
                          height: `${Math.max(28, durationHeight - 2)}px`,
                          "--event-lane": layout.lane,
                          "--event-lanes": layout.lanes
                        } as CSSProperties;
                        const canDrag = !layout.event.recurrenceMasterId && !layout.event.recurrence;
                        return (
                          <button
                            className={["calendar-week-timed-event", canDrag ? "movable" : "", draggedEventId === layout.event.id ? "dragging" : ""].filter(Boolean).join(" ")}
                            style={eventStyle}
                            type="button"
                            key={layout.event.id}
                            title={`${calendarEventDisplayTitle(layout.event)}\n${eventTimeRange(layout.event)}${layout.event.location ? `\n${layout.event.location}` : ""}${canDrag ? "\nZum Verschieben ziehen" : ""}`}
                            onClick={(event) => openEventFromClick(event, layout.event)}
                            onContextMenu={(event) => openEventContextMenu(event, layout.event)}
                            onPointerDown={(event) => canDrag && beginEventPointerDrag(event, layout.event.id)}
                            onPointerMove={(event) => canDrag && updateEventPointerDrag(event)}
                            onPointerUp={(event) => canDrag && finishEventPointerDrag(event)}
                            onPointerCancel={(event) => canDrag && cancelEventPointerDrag(event)}
                          >
                            <strong>{calendarEventDisplayTitle(layout.event)}</strong>
                            <time>{eventTimeRange(layout.event)}</time>
                            {layout.event.location && <small>{layout.event.location}</small>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="calendar-week-help">Freien Zeitraum markieren: Termin erstellen · Termin ziehen: verschieben</p>
        </section>
      )}

      {view === "day" && (
        <section className="calendar-day-schedule" aria-label="Tageskalender">
          <div className="calendar-day-scroll" ref={timeGridScrollRef}>
            <div className="calendar-day-head">
              <div className="calendar-week-timezone" title="Zeitzone">MEZ</div>
              <div className={sameDay(cursor, new Date()) ? "today" : ""}>
                <span>{new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(cursor)}</span>
                <strong>{cursor.getDate()}</strong>
                <small>{new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(cursor)}</small>
              </div>
            </div>
            <AllDayEventStrip days={[cursor]} events={sortedEvents} onOpen={openEvent} onContextMenu={openEventContextMenu} />
            <div
              className="calendar-day-timeline"
              style={{ "--calendar-hour-height": `${advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight}px`, "--calendar-half-hour-height": `${(advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) / 2}px`, height: `${(advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) * 24}px` } as CSSProperties}
            >
              <div className="calendar-time-axis" aria-hidden="true">
                {calendarHours.map((hour) => <time key={hour} style={{ top: `${hour * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}>{String(hour).padStart(2, "0")}:00</time>)}
              </div>
              <div
                className={["calendar-week-day-track", "calendar-day-track", sameDay(cursor, new Date()) ? "today" : "", eventDropPreview?.kind === "time" && eventDropPreview.dayKey === dateInputValue(cursor) ? "drop-preview-active" : ""].filter(Boolean).join(" ")}
                role="gridcell"
                aria-label={`${new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(cursor)}. Freien Zeitraum markieren, um einen Termin zu erstellen.`}
                data-calendar-day={dateInputValue(cursor)}
                data-calendar-drop-kind="time"
                onPointerDown={(event) => beginTimeSelection(cursor, event)}
                onPointerMove={(event) => updateTimeSelection(cursor, event)}
                onPointerUp={(event) => finishTimeSelection(cursor, event)}
                onPointerCancel={() => setActiveTimeSelection(null)}
                onLostPointerCapture={() => { if (timeSelectionRef.current) setActiveTimeSelection(null); }}
              >
                {sameDay(cursor, new Date()) && (() => {
                  const now = currentTime;
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();
                  return <span className="calendar-current-time-line" style={{ top: `${(nowMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}><i /></span>;
                })()}
                {timeSelection?.dayKey === dateInputValue(cursor) && (() => {
                  const bounds = calendarTimeSelectionBounds(timeSelection);
                  return <span className="calendar-time-selection" style={{ top: `${(bounds.startMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px`, height: `${((bounds.endMinutes - bounds.startMinutes) / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight)}px` }}><strong>{formatTimeSelection(timeSelection)}</strong></span>;
                })()}
                {eventDropPreview?.kind === "time" && eventDropPreview.dayKey === dateInputValue(cursor) && (
                  <span className="calendar-event-drop-preview" style={calendarEventDropPreviewStyle(eventDropPreview.event, advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight, 32)} aria-hidden="true">
                    <strong>{eventDropPreview.event.title || "Ohne Titel"}</strong>
                    <time>{eventTimeRange(eventDropPreview.event)}</time>
                  </span>
                )}
                {dayLayouts.map((layout) => {
                  const durationHeight = ((layout.endMinutes - layout.startMinutes) / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight);
                  const eventStyle = {
                    ...calendarColorStyle(layout.event.color),
                    top: `${(layout.startMinutes / 60) * (advancedMode ? advancedSettings.hourHeight : compactCalendarHourHeight) + 1}px`,
                    height: `${Math.max(32, durationHeight - 2)}px`,
                    "--event-lane": layout.lane,
                    "--event-lanes": layout.lanes
                  } as CSSProperties;
                  const canDrag = !layout.event.recurrenceMasterId && !layout.event.recurrence;
                  return (
                    <button
                      className={["calendar-week-timed-event", "calendar-day-timed-event", canDrag ? "movable" : "", draggedEventId === layout.event.id ? "dragging" : ""].filter(Boolean).join(" ")}
                      style={eventStyle}
                      type="button"
                      key={layout.event.id}
                      title={`${calendarEventDisplayTitle(layout.event)}\n${eventTimeRange(layout.event)}${layout.event.location ? `\n${layout.event.location}` : ""}${canDrag ? "\nZum Verschieben ziehen" : ""}`}
                      onClick={(event) => openEventFromClick(event, layout.event)}
                      onContextMenu={(event) => openEventContextMenu(event, layout.event)}
                      onPointerDown={(event) => canDrag && beginEventPointerDrag(event, layout.event.id)}
                      onPointerMove={(event) => canDrag && updateEventPointerDrag(event)}
                      onPointerUp={(event) => canDrag && finishEventPointerDrag(event)}
                      onPointerCancel={(event) => canDrag && cancelEventPointerDrag(event)}
                    >
                      <strong>{calendarEventDisplayTitle(layout.event)}</strong>
                      <time>{eventTimeRange(layout.event)}</time>
                      {layout.event.category && <small>{layout.event.category}</small>}
                      {layout.event.location && <small>{layout.event.location}</small>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="calendar-week-help">Freien Zeitraum markieren: Termin erstellen · Termin ziehen: verschieben</p>
        </section>
      )}
      </div></section>}

      {eventContextMenu && (() => {
        const target = normalizeEvent(contextMenuMaster(eventContextMenu.event));
        const meeting = target.meeting ?? blankEvent().meeting!;
        const toggleSubmenu = (submenu: Exclude<CalendarEventContextSubmenu, null>) => {
          setEventContextMenu((current) => current ? { ...current, submenu: current.submenu === submenu ? null : submenu } : null);
        };
        const availabilityOptions: Array<{ value: CalendarAvailability; label: string }> = [
          { value: "free", label: "Frei" },
          { value: "tentative", label: "Mit Vorbehalt" },
          { value: "busy", label: "Beschäftigt" },
          { value: "oof", label: "Abwesend" },
          { value: "workingElsewhere", label: "Anderswo arbeiten" }
        ];
        return <div
          className="calendar-event-context-menu"
          role="menu"
          aria-label={`Aktionen für ${target.title || "Termin"}`}
          style={{ left: eventContextMenu.x, top: eventContextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" role="menuitem" onClick={() => { setEventContextMenu(null); setEventToPrint(target); }}><Printer size={17} /> Drucken</button>
          <button type="button" role="menuitem" onClick={() => { setEventContextMenu(null); openEvent(target); }}><ExternalLink size={17} /> Öffnen</button>
          <button type="button" role="menuitem" onClick={() => void forwardContextMenuEvent(target)}><Forward size={17} /> Weiterleiten</button>
          <span className="calendar-event-context-separator" />
          <button type="button" role="menuitem" aria-expanded={eventContextMenu.submenu === "symbol"} onClick={() => toggleSubmenu("symbol")}><Palette size={17} /> Symbol <ChevronRight className="calendar-event-context-chevron" size={16} /></button>
          {eventContextMenu.submenu === "symbol" && <div className="calendar-event-context-submenu" role="group" aria-label="Symbol auswählen">
            {calendarColorOptions.map((color) => <button className={target.color === color.value ? "selected" : ""} type="button" key={color.value} onClick={() => updateContextMenuEvent(target, { color: color.value })}><i style={{ background: color.border }} /> {color.label}</button>)}
          </div>}
          <button type="button" role="menuitem" aria-expanded={eventContextMenu.submenu === "availability"} onClick={() => toggleSubmenu("availability")}><Eye size={17} /> Anzeigen als <ChevronRight className="calendar-event-context-chevron" size={16} /></button>
          {eventContextMenu.submenu === "availability" && <div className="calendar-event-context-submenu" role="group" aria-label="Verfügbarkeit auswählen">
            {availabilityOptions.map((option) => <button className={meeting.showAs === option.value ? "selected" : ""} type="button" key={option.value} onClick={() => updateContextMenuEvent(target, { meeting: { ...meeting, showAs: option.value } })}>{option.label}</button>)}
          </div>}
          <button type="button" role="menuitem" aria-expanded={eventContextMenu.submenu === "category"} onClick={() => toggleSubmenu("category")}><Tag size={17} /> Kategorisieren <ChevronRight className="calendar-event-context-chevron" size={16} /></button>
          {eventContextMenu.submenu === "category" && <div className="calendar-event-context-submenu" role="group" aria-label="Kategorie auswählen">
            <button className={!target.category ? "selected" : ""} type="button" onClick={() => updateContextMenuEvent(target, { category: "" })}>Keine Kategorie</button>
            {categoryOptions.map((category) => <button className={target.category === category ? "selected" : ""} type="button" key={category} onClick={() => updateContextMenuEvent(target, { category })}>{category}</button>)}
          </div>}
          <button type="button" role="menuitemcheckbox" aria-checked={meeting.isPrivate} onClick={() => updateContextMenuEvent(target, { meeting: { ...meeting, isPrivate: !meeting.isPrivate } })}><Lock size={17} /> Privat {meeting.isPrivate && <span className="calendar-event-context-check">✓</span>}</button>
          <span className="calendar-event-context-separator" />
          <button type="button" role="menuitem" onClick={() => duplicateContextMenuEvent(target)}><Copy size={17} /> Ereignis duplizieren</button>
          <button type="button" role="menuitem" onClick={() => void exportContextMenuEvent(target)}><Download size={17} /> Als .ics speichern</button>
          <span className="calendar-event-context-separator" />
          <button className="danger" type="button" role="menuitem" onClick={() => { setEventContextMenu(null); deleteEvent(target); }}><Trash2 size={17} /> Löschen</button>
        </div>;
      })()}

      {eventToPrint && <section className="calendar-event-print-sheet" aria-hidden="true">
        <p>DMH Backup · Kalender</p>
        <h1>{eventToPrint.title || "Ohne Titel"}</h1>
        <dl>
          <div><dt>Datum</dt><dd>{formatCalendarDate(eventToPrint.startsAt)}</dd></div>
          <div><dt>Uhrzeit</dt><dd>{eventToPrint.isAllDay ? "Ganztägig" : eventTimeRange(eventToPrint)}</dd></div>
          {eventToPrint.location && <div><dt>Ort</dt><dd>{eventToPrint.location}</dd></div>}
          {eventToPrint.category && <div><dt>Kategorie</dt><dd>{eventToPrint.category}</dd></div>}
        </dl>
        {eventToPrint.description && <p className="calendar-event-print-description">{eventToPrint.description}</p>}
      </section>}

      <EasyImportDialog
        kind="calendar"
        open={easyImportOpen}
        onClose={() => setEasyImportOpen(false)}
        onManageSync={() => {
          setEasyImportOpen(false);
          onNavigate("synchronizations");
        }}
        onImported={async () => {
          await loadVisibleEvents();
          const storedCategories = JSON.parse(localStorage.getItem(calendarCategoriesStorageKey) ?? "[]") as CalendarCategory[];
          setCategories(storedCategories.map(normalizeCategory).filter((category) => category.name));
        }}
      />

      <CalendarReconciliationDialog
        open={reconciliationOpen}
        events={reconciliationEvents}
        onClose={() => { setReconciliationOpen(false); setReconciliationEvents([]); }}
        onChanged={(nextEvents) => {
          persist(nextEvents);
          try {
            const storedCategories = JSON.parse(localStorage.getItem(calendarCategoriesStorageKey) ?? "[]") as CalendarCategory[];
            setCategories(storedCategories.map(normalizeCategory).filter((category) => category.name));
          } catch {
            // The event changes remain visible even if a category cannot be read.
          }
          window.dispatchEvent(new Event(calendarChangedEventName));
        }}
      />
    </div>
  );
}
