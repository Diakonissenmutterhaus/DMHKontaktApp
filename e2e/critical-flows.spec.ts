import { expect, test, type Page } from "@playwright/test";
import type { CalendarEvent } from "../src/types/calendar";
import type { AuditLogEntry } from "../src/types/audit";

type MockContact = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  privateEmail: string;
  secondPrivateEmail: string;
  phone: string;
  mobilePhone: string;
  privatePhone: string;
  secondPrivatePhone: string;
  company: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
  shortInfo: string;
  notes: string;
  groups: unknown[];
  createdAt: string;
  updatedAt: string;
};

function mockContact(id: number, firstName: string, lastName: string): MockContact {
  return {
    id,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`,
    email: `${firstName}.${lastName}@example.test`.toLowerCase(),
    privateEmail: "",
    secondPrivateEmail: "",
    phone: "",
    mobilePhone: "",
    privatePhone: "",
    secondPrivatePhone: "",
    company: "DMH",
    street: "",
    postalCode: "",
    city: "Aidlingen",
    country: "Deutschland",
    shortInfo: "",
    notes: "",
    groups: [],
    createdAt: "2026-09-24T08:00:00Z",
    updatedAt: "2026-09-24T08:00:00Z"
  };
}

async function installTauriMock(page: Page, contacts: MockContact[], options: { loadDelayMs?: number; calendarEvents?: CalendarEvent[]; auditEntries?: AuditLogEntry[] } = {}) {
  await page.addInitScript(({ seedContacts, seedCalendarEvents, loadDelayMs, auditEntries }) => {
    let callbackId = 0;
    let edvUnlocked = false;
    const diagnostics: unknown[] = [];
    const bulkRemovals: unknown[] = [];
    Object.defineProperty(window, "__DMH_TEST_BULK_REMOVALS__", { value: bulkRemovals });
    const bulkMatches = (filter: Record<string, any>) => {
      const rows = filter.kind === "calendar" ? seedCalendarEvents.map(event => ({ id: event.id, title: event.title, start: event.startsAt, end: event.endsAt, source: event.source, category: event.category, email: "", company: "", groups: "", series: Boolean(event.recurrence) })) : seedContacts.map(contact => ({ id: String(contact.id), title: contact.displayName, start: "", end: "", source: "", category: "", email: contact.email, company: contact.company, groups: "", series: false }));
      return rows.filter(item => (!filter.search || (filter.exact ? item.title.toLowerCase() === filter.search.toLowerCase() : `${item.title} ${item.email} ${item.company}`.toLowerCase().includes(filter.search.toLowerCase()))) && (!filter.source || filter.source === item.source) && (!filter.category || filter.category === item.category) && (!filter.company || filter.company === item.company) && (!filter.fromDate || item.start.slice(0, 10) >= filter.fromDate) && (!filter.toDate || item.start.slice(0, 10) <= filter.toDate));
    };
    Object.defineProperty(window, "__DMH_TEST_DIAGNOSTICS__", { value: diagnostics });
    const callbacks = new Map<number, (...args: unknown[]) => void>();
    const invoke = async (command: string, args?: Record<string, any>) => {
      if (loadDelayMs > 0 && ["list_contacts", "list_groups", "get_contact_overview_counts", "get_calendar_overview", "list_calendar_events_in_range", "list_calendar_events"].includes(command)) {
        await new Promise((resolve) => window.setTimeout(resolve, loadDelayMs));
      }
      switch (command) {
        case "list_edv_bulk_items": {
          if (!edvUnlocked) throw new Error("EDV-Zugriff erforderlich");
          const filter = args?.filter ?? {}; const matches = bulkMatches(filter);
          return { items: matches.slice(filter.offset ?? 0, (filter.offset ?? 0) + 100), total: matches.length, sources: [...new Set(seedCalendarEvents.map(e => e.source))], categories: [...new Set(seedCalendarEvents.map(e => e.category))], companies: [...new Set(seedContacts.map(c => c.company))], groups: [] };
        }
        case "preview_edv_bulk_removal": {
          if (!edvUnlocked) throw new Error("EDV-Zugriff erforderlich");
          const selection = args?.selection;
          const selected = (selection.allMatching ? bulkMatches(selection.filter).filter(item => !selection.excludedIds.includes(item.id)) : bulkMatches({ kind: selection.filter.kind }).filter(item => selection.ids.includes(item.id)));
          return { selected: selected.length, affected: selected.length, series: 0, revision: "preview" };
        }
        case "execute_edv_bulk_removal": {
          if (!edvUnlocked) throw new Error("EDV-Zugriff erforderlich");
          const selection = args?.selection;
          const ids = new Set((selection.allMatching ? bulkMatches(selection.filter).filter(item => !selection.excludedIds.includes(item.id)) : bulkMatches({ kind: selection.filter.kind }).filter(item => selection.ids.includes(item.id))).map(item => item.id));
          bulkRemovals.push({ ...selection, affected: ids.size });
          if (selection.filter.kind === "calendar") seedCalendarEvents.splice(0, seedCalendarEvents.length, ...seedCalendarEvents.filter(e => !ids.has(e.id)));
          else seedContacts.splice(0, seedContacts.length, ...seedContacts.filter(c => !ids.has(String(c.id))));
          return ids.size;
        }
        case "record_ui_diagnostic": diagnostics.push(args?.entry); return null;
        case "unlock_edv_tools": edvUnlocked = args?.password === "test-edv"; return edvUnlocked;
        case "lock_edv_tools": edvUnlocked = false; return null;
        case "list_audit_log": {
          if (!edvUnlocked) throw "EDV-Zugang erforderlich";
          const filter = args?.filter ?? {};
          return { entries: auditEntries.filter((entry) => (!filter.action || entry.action === filter.action) && (!filter.source || entry.source === filter.source) && (!filter.search || filter.search.toLowerCase().split(/\s+/).every((word: string) => entry.summary.toLowerCase().includes(word)))), hasMore: false };
        }
        case "list_mail_accounts":
        case "list_printers":
        case "list_printer_drivers": return [];
        case "get_vault_status":
          return { protectionEnabled: false, unlocked: true, username: "", recoveryEmail: "", recoveryEmailHint: "", recoveryAvailable: false, entryCount: 0 };
        case "get_microsoft365_connection_status":
        case "get_m365_connection_status":
          return { connected: false, accountName: "", accountEmail: "" };
        case "get_m365_read_only_test_mode":
          return false;
        case "get_calendar_category_rules":
          return [];
        case "list_contacts":
          return seedContacts;
        case "list_groups":
          return [];
        case "get_contact_overview_counts":
          return { total: seedContacts.length, ungrouped: seedContacts.length, groups: {} };
        case "get_app_setting":
          return null;
        case "get_calendar_overview":
          return { total: seedCalendarEvents.length, sources: [...new Set(seedCalendarEvents.map((event) => event.source))] };
        case "list_calendar_events_in_range":
        case "list_calendar_events":
          return seedCalendarEvents;
        case "plugin:event|listen":
          return ++callbackId;
        case "plugin:event|unlisten":
        case "plugin:updater|check":
        case "sync_offline_documents":
        case "create_automatic_safety_backup":
          return null;
        default:
          return null;
      }
    };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        invoke,
        transformCallback(callback: (...args: unknown[]) => void) {
          const id = ++callbackId;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        convertFileSrc(path: string) {
          return path;
        }
      }
    });
  }, { seedContacts: contacts, seedCalendarEvents: options.calendarEvents ?? [], loadDelayMs: options.loadDelayMs ?? 0, auditEntries: options.auditEntries ?? [] });
}

test("Massenlöschung seleciona todos os resultados entre páginas e confirma o alcance Exchange", async ({ page }, testInfo) => {
  const events: CalendarEvent[] = Array.from({ length: 125 }, (_, index) => ({ id: `lunch-${index}`, title: "Mittagspause", startsAt: "2026-10-12T12:00", endsAt: "2026-10-12T13:00", location: "", description: "", color: "blue", category: "Work", source: "Microsoft 365" }));
  events.push({ ...events[0], id: "keep", title: "Dienstbesprechung" });
  await installTauriMock(page, [mockContact(1, "Anna", "Muster")], { calendarEvents: events });
  await page.goto("/");
  expect(await page.evaluate(async () => { try { await (window as any).__TAURI_INTERNALS__.invoke("list_edv_bulk_items", { filter: { kind: "calendar" } }); return false; } catch { return true; } })).toBe(true);
  await page.getByRole("button", { name: "EDV Tools", exact: true }).click();
  await page.getByLabel("EDV-Kennwort", { exact: true }).fill("test-edv");
  await page.getByRole("button", { name: "EDV Tools öffnen" }).click();
  await page.getByRole("button", { name: "Massenlöschung", exact: true }).click();
  await page.getByRole("searchbox", { name: "Termine suchen" }).fill("mittagspause");
  await page.getByRole("checkbox", { name: "Titel stimmt genau überein" }).check();
  await expect(page.getByRole("button", { name: "Alle 125 Treffer auswählen" })).toBeEnabled();
  await page.getByRole("button", { name: "Alle 125 Treffer auswählen" }).click();
  await page.getByRole("button", { name: "Nächste Seite" }).click();
  const rows = page.getByRole("table", { name: "Kalendereinträge für Massenlöschung" }).getByRole("checkbox", { name: /Mittagspause,/ });
  await expect(rows).toHaveCount(25);
  await rows.first().uncheck();
  await page.screenshot({ path: testInfo.outputPath("massenloeschung-kalender.png") });
  await page.getByRole("button", { name: "124 ausgewählte löschen" }).click();
  await expect(page.getByRole("dialog")).toContainText("Exchange");
  expect(await page.evaluate(() => (window as any).__DMH_TEST_BULK_REMOVALS__.length)).toBe(0);
  await page.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await page.getByRole("button", { name: "124 ausgewählte löschen" }).click();
  await page.getByRole("button", { name: "Auswahl in den Papierkorb verschieben" }).click();
  await expect(page.locator(".bulk-result")).toContainText("124 Kalendereinträge");
  await expect(page.getByRole("table").getByRole("checkbox", { name: /Mittagspause,/ })).toHaveCount(1);
  await page.getByRole("button", { name: "Kontakte", exact: true }).last().click();
  await page.getByRole("checkbox", { name: "Anna Muster, anna.muster@example.test" }).check();
  await page.getByRole("button", { name: "1 ausgewählte löschen" }).click();
  await page.getByRole("button", { name: "Auswahl in den Papierkorb verschieben" }).click();
  await expect(page.locator(".bulk-result")).toContainText("1 Kontakte");
  await page.setViewportSize({ width: 780, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("massenloeschung-klein.png") });
});

test("erros internos ficam silenciosos e falhas definitivas mostram o evento e a correção", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("dmh:calendar-automatic-sync-status", { detail: { state: "error", message: "Exchange konnte 1 Änderung(en) noch nicht übernehmen: UNIQUE constraint failed: m365_contact_links.source_id, m365_contact_links.remote_id" } })));
  await expect(page.getByText(/UNIQUE constraint/)).toHaveCount(0);
  await expect(page.locator(".calendar-page .status")).toHaveCount(0);
  await page.evaluate(async () => {
    const policy = await import("/src/utils/notificationPolicy.ts");
    const publicMessage = policy.notifyExchangeFailures([{ entityKind: "calendar", entityId: "m365:a:one", title: "Arzttermin", startsAt: "2026-10-12T15:00", operation: "upsert", sourceId: "a", error: "HTTP 403 ErrorAccessDenied", userMessage: "Bitte einen beschreibbaren Zielkalender wählen oder die EDV um Freigabe bitten." }]);
    window.dispatchEvent(new CustomEvent("dmh:calendar-automatic-sync-status", { detail: { state: "error", message: "HTTP 403 ErrorAccessDenied", publicMessage } }));
  });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Arzttermin");
  await expect(alert).toContainText("15:00");
  await expect(alert).toContainText("Zielkalender wählen");
  await expect(alert).not.toContainText("HTTP");
  await page.screenshot({ path: testInfo.outputPath("falha-exchange-acao-clara.png") });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("dmh:calendar-automatic-sync-status", { detail: { state: "error", message: "HTTP 503" } })));
  await expect(alert).toContainText("Arzttermin");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("dmh:calendar-automatic-sync-status", { detail: { state: "success", pendingOutbound: 1, message: "already synced" } })));
  await expect(alert).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("dmh:calendar-automatic-sync-status", { detail: { state: "success", pendingOutbound: 0, message: "already synced" } })));
  await expect(alert).toHaveCount(0);
});

test("a história de erros exige acesso EDV e permite buscar mensagem e evento", async ({ page }, testInfo) => {
  await installTauriMock(page, [], { auditEntries: [{ id: 1, occurredAt: "2026-10-12T09:32:41Z", actor: "Test", source: "diagnostic", action: "error", entityKind: "calendar", entityId: "event-1", summary: "Mittagspause\nItem: event-1\nTermin: 2026-10-12T12:00\nVorgang: upsert\nUrsprung: Exchange\nMeldung: HTTP 404 ErrorItemNotFound" }] });
  await page.goto("/");
  expect(await page.evaluate(async () => { try { await (window as any).__TAURI_INTERNALS__.invoke("list_audit_log", { filter: {} }); return false; } catch { return true; } })).toBe(true);
  await page.getByRole("button", { name: "EDV Tools", exact: true }).click();
  await page.getByLabel("EDV-Kennwort", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "EDV Tools öffnen" }).click();
  await expect(page.getByText("Das EDV-Kennwort ist nicht korrekt.")).toBeVisible();
  await page.getByLabel("EDV-Kennwort", { exact: true }).fill("test-edv");
  await page.getByRole("button", { name: "EDV Tools öffnen" }).click();
  await page.getByRole("button", { name: "Historie", exact: true }).click();
  await page.getByRole("combobox", { name: "Aktion", exact: true }).selectOption("error");
  await page.getByRole("combobox", { name: "Herkunft", exact: true }).selectOption("diagnostic");
  await page.getByRole("searchbox", { name: "Historie durchsuchen" }).fill("404 event-1");
  await expect(page.locator(".audit-log-entry")).toContainText("Mittagspause");
  await expect(page.locator(".audit-log-entry")).toContainText("2026-10-12T12:00");
  await expect(page.locator(".audit-log-entry")).toContainText("upsert");
  await expect(page.locator(".audit-log-entry")).toContainText("ErrorItemNotFound");
  await page.screenshot({ path: testInfo.outputPath("historie-diagnostico-edv.png") });
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => { try { await (window as any).__TAURI_INTERNALS__.invoke("list_audit_log", { filter: {} }); return false; } catch { return true; } })).toBe(true);
});

test("zero contatos abre a página normalmente e só mostra o importador após escolha", async ({ page }) => {
  await installTauriMock(page, []);
  await page.goto("/");
  await page.getByRole("button", { name: "Kontakte", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Noch keine Kontakte" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Kontakte einfach importieren/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Einfach importieren/ }).click();
  const dialog = page.getByRole("dialog", { name: /Kontakte einfach importieren/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Outlook Classic/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Thunderbird/ })).toBeVisible();
});

test("seleção múltipla, menu e alterações não salvas funcionam juntos", async ({ page }) => {
  await installTauriMock(page, [
    mockContact(1, "Anna", "Adler"),
    mockContact(2, "Berta", "Bauer"),
    mockContact(3, "Clara", "Christ")
  ]);
  await page.goto("/");
  await page.getByRole("button", { name: "Kontakte", exact: true }).click();

  const rows = page.getByRole("listbox", { name: "Kontakte" }).getByRole("option");
  await expect(rows).toHaveCount(3);
  const panes = await page.locator(".groups-panel, .contacts-main, .contact-inspector").evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width };
  }));
  expect(panes).toHaveLength(3);
  expect(panes.every((pane) => pane.width > 100)).toBe(true);
  expect(panes[0].right).toBeLessThanOrEqual(panes[1].left + 1);
  expect(panes[1].right).toBeLessThanOrEqual(panes[2].left + 1);

  await rows.nth(0).click({ modifiers: ["Control"] });
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(0)).toHaveCSS("user-select", "none");

  await rows.nth(0).click();
  await page.getByRole("button", { name: "Aktionen für Anna Adler" }).click();
  await expect(page.getByRole("menuitem", { name: /Löschen/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByLabel("Vorname").fill("Anneliese");
  await rows.nth(1).click();
  const dialog = page.getByRole("dialog", { name: /Nicht gespeicherte Änderungen/ });
  await expect(dialog).toContainText("Anna");
  await expect(dialog).toContainText("Anneliese");
  await dialog.getByRole("button", { name: /Änderungen verwerfen/ }).click();
  await expect(page.getByLabel("Vorname")).toHaveValue("Berta");
});

test.describe("rolagem inicial do calendário", () => {
  test.use({ timezoneId: "Europe/Berlin" });
  for (const scenario of [
    { view: "week", advanced: false, hourHeight: 60, width: 1440 },
    { view: "day", advanced: false, hourHeight: 60, width: 760 },
    { view: "workweek", advanced: true, hourHeight: 52, width: 1440 },
    { view: "week", advanced: true, hourHeight: 84, width: 1440 }
  ]) {
    test(`centraliza 14:37 ao entrar e voltar: ${scenario.view}, escala ${scenario.hourHeight}px`, async ({ page }) => {
      await page.clock.setFixedTime("2026-10-09T14:37:00+02:00");
      await page.setViewportSize({ width: scenario.width, height: 900 });
      await installTauriMock(page, [], { loadDelayMs: 250, calendarEvents: Array.from({ length: 3 }, (_, index) => ({
        id: `all-day-${index}`, title: `Ganztägig ${index}`, startsAt: "2026-10-09T00:00", endsAt: "2026-10-10T00:00",
        isAllDay: true, location: "", description: "", color: "blue", category: "", source: "DMH Backup"
      })) });
      await page.addInitScript(({ view, advanced, hourHeight }) => {
        localStorage.setItem("agendakontakte.calendarView.v1", view);
        localStorage.setItem("dmh.calendar.advanced.v1", String(advanced));
        localStorage.setItem("agendakontakte.calendarAdvancedSettings.v1", JSON.stringify({ hourHeight, hiddenSources: [] }));
      }, scenario);
      await page.goto("/");
      const grid = page.locator(".calendar-week-scroll, .calendar-day-scroll");
      const checkCentered = async () => {
        await expect(grid.locator(".calendar-current-time-line")).toBeVisible();
        await expect.poll(() => grid.evaluate((element) => {
          const pinnedHeight = Array.from(element.querySelectorAll(".calendar-week-head, .calendar-day-head, .calendar-all-day-strip"))
            .reduce((height, header) => height + header.getBoundingClientRect().height, 0);
          const center = element.getBoundingClientRect().top + element.clientTop + pinnedHeight + (element.clientHeight - pinnedHeight) / 2;
          return Math.abs(element.querySelector(".calendar-current-time-line")!.getBoundingClientRect().top - center);
        })).toBeLessThan(2);
      };
      await page.getByRole("button", { name: "Kalender", exact: true }).click();
      await checkCentered();
      await grid.evaluate((element) => { element.scrollTop = 0; });
      await page.getByRole("button", { name: "Kontakte", exact: true }).click();
      await page.getByRole("button", { name: "Kalender", exact: true }).click();
      await checkCentered();
    });
  }
});

test("evento de dia inteiro usa a faixa superior e esconde horários", async ({ page }) => {
  await installTauriMock(page, [mockContact(1, "Anna", "Adler")]);
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByRole("button", { name: /Neuer Termin/ }).click();
  await page.getByPlaceholder("Titel hinzufügen").fill("Fortbildung");

  const editorBox = await page.locator(".calendar-meeting-editor").boundingBox();
  const fieldsBox = await page.locator(".calendar-meeting-fields").boundingBox();
  const plannerBox = await page.locator(".calendar-meeting-planner").boundingBox();
  expect(editorBox).not.toBeNull();
  expect(fieldsBox).not.toBeNull();
  expect(plannerBox).not.toBeNull();
  expect(fieldsBox!.x + fieldsBox!.width).toBeLessThanOrEqual(plannerBox!.x + 1);
  await expect(page.locator(".calendar-meeting-footer")).toBeVisible();

  await page.getByRole("checkbox", { name: /Ganztägig/ }).check();

  await expect(page.getByLabel("Startzeit")).toHaveCount(0);
  await expect(page.getByLabel("Endzeit")).toHaveCount(0);
  await expect(page.getByLabel("Ganztägige Termine")).toContainText("Fortbildung");
  await expect(page.getByRole("button", { name: /Speichern/ })).toBeEnabled();
});

test("novo evento mantém fontes uniformes e o formulário cabe em diferentes janelas", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByRole("button", { name: /Neuer Termin/ }).click();
  await page.getByLabel("Startzeit").fill("08:30");
  await page.getByLabel("Endzeit").fill("10:45");

  const editor = page.locator(".calendar-meeting-editor");
  const fontSizes = await editor.locator('.calendar-meeting-field input:not([type="checkbox"])').evaluateAll((fields) => fields.map((field) => getComputedStyle(field).fontSize));
  expect([...new Set(fontSizes)]).toEqual(["15px"]);
  await expect(editor.locator("textarea")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".calendar-meeting-commandbar").getByRole("button", { name: /Speichern/ })).toBeVisible();
  const saveBox = await editor.getByRole("button", { name: /Speichern/ }).boundingBox();
  const categoryBox = await editor.getByLabel("Kategorie", { exact: true }).boundingBox();
  expect(saveBox!.y).toBeLessThan(categoryBox!.y + categoryBox!.height);
  await expect(page.locator(".calendar-meeting-footer")).toContainText("DMH Backup");
  await page.locator(".calendar-event-dialog").screenshot({ path: testInfo.outputPath("novo-evento-desktop.png") });

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(editor).toBeVisible();
  const horizontalOverflow = await editor.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(horizontalOverflow).toBe(false);
  await expect(editor.getByRole("button", { name: /Speichern/ })).toBeVisible();
  await page.getByPlaceholder("Titel hinzufügen").fill("Planejamento");
  await page.getByRole("checkbox", { name: /Ganztägig/ }).check();
  await expect(page.getByLabel("Enddatum", { exact: true })).toBeVisible();
  await expect(page.locator(".calendar-meeting-footer")).toBeInViewport();
  await expect(editor.getByRole("button", { name: /Speichern/ })).toBeEnabled();
  await page.locator(".calendar-event-dialog").screenshot({ path: testInfo.outputPath("novo-evento-compacto.png") });
});

test("Tagesübersicht mostra a madrugada, separa eventos e o editor ocupa a altura disponível", async ({ page }, testInfo) => {
  await page.clock.setFixedTime("2026-10-08T14:00:00+02:00");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installTauriMock(page, [], { calendarEvents: [
    { title: "Mittagspause", start: "12:00", end: "13:00" },
    { title: "Kita", start: "13:00", end: "14:00" },
    { title: "Rebekka Kita", start: "13:30", end: "14:00" }
  ].map((event, index) => ({ id: `planner-${index}`, title: event.title, startsAt: `2026-10-08T${event.start}`, endsAt: `2026-10-08T${event.end}`, location: "", description: "", color: "blue", category: "", source: "DMH Backup" })) });
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByRole("button", { name: /Neuer Termin/ }).click();
  await page.getByPlaceholder("Titel hinzufügen").fill("Neuer Termin Test");
  await page.getByLabel("Startzeit").fill("02:45");
  await page.getByLabel("Endzeit").fill("04:15");
  const timeline = page.locator(".calendar-planner-timeline");
  const draft = timeline.locator(".draft");
  const draftFits = () => draft.evaluate((element) => {
    const viewport = element.closest(".calendar-planner-timeline")!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return box.top >= viewport.top && box.bottom <= viewport.bottom;
  });
  await expect(draft).toContainText("02:45–04:15");
  await expect.poll(draftFits).toBe(true);
  const sizes = await page.locator(".calendar-meeting-editor").evaluate((editor) => ({
    descriptionBottom: editor.querySelector(".calendar-description-card")!.getBoundingClientRect().bottom,
    plannerBottom: editor.querySelector(".calendar-meeting-planner")!.getBoundingClientRect().bottom,
    textareaHeight: editor.querySelector("textarea")!.getBoundingClientRect().height
  }));
  expect(Math.abs(sizes.descriptionBottom - sizes.plannerBottom)).toBeLessThan(5);
  expect(sizes.textareaHeight).toBeGreaterThan(180);
  await page.locator(".calendar-event-dialog").screenshot({ path: testInfo.outputPath("planner-madrugada.png") });

  await page.getByLabel("Startzeit").fill("15:00");
  await page.getByLabel("Endzeit").fill("16:00");
  await expect(draft).toContainText("15:00–16:00");
  await expect.poll(draftFits).toBe(true);
  for (const [title, times] of [["Mittagspause", "12:00–13:00"], ["Kita", "13:00–14:00"], ["Rebekka Kita", "13:30–14:00"]]) {
    const card = timeline.getByLabel(`${title}, ${times}`, { exact: true });
    await expect(card).toBeVisible();
    await expect(card.locator("span")).toHaveText(times);
    expect(await card.evaluate((element) => element.querySelector("span")!.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom)).toBe(true);
  }
  const kita = await timeline.getByLabel("Kita, 13:00–14:00", { exact: true }).boundingBox();
  const rebekka = await timeline.getByLabel("Rebekka Kita, 13:30–14:00", { exact: true }).boundingBox();
  expect(kita!.x + kita!.width + 2).toBeLessThanOrEqual(rebekka!.x);
  await page.locator(".calendar-event-dialog").screenshot({ path: testInfo.outputPath("planner-eventos-separados.png") });
  await page.setViewportSize({ width: 760, height: 900 });
  const overflow = await page.locator(".calendar-meeting-editor").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("série recebida do Exchange abre com repetição e preserva o link do Teams", async ({ page }, testInfo) => {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await installTauriMock(page, [], { calendarEvents: [{
    id: "m365:calendar-a:series-1", title: "Série do Exchange", startsAt: `${day}T09:00`, endsAt: `${day}T10:00`,
    location: "SR2", description: "Descrição da série", color: "blue", category: "", source: "Microsoft 365 · Arbeit",
    recurrence: { frequency: "weekly", interval: 2, daysOfWeek: [today.getDay()], firstDayOfWeek: 1, count: 4 },
    meeting: { requiredAttendees: [], optionalAttendees: [], showAs: "busy", reminderMinutes: 15, isPrivate: false, isOnlineMeeting: true, onlineMeetingUrl: "https://teams.microsoft.com/l/meetup-join/example" }
  }] });
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByRole("button", { name: /Série do Exchange/ }).first().click();
  const editor = page.locator(".calendar-meeting-editor");
  await expect(editor.getByRole("button", { name: "Serie", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByLabel("Wiederholung")).toHaveValue("weekly");
  await expect(editor.getByLabel("Intervall")).toHaveValue("2");
  await expect(editor.getByLabel("Anzahl Termine")).toHaveValue("4");
  await expect(editor.getByRole("checkbox", { name: "Teams-Besprechung", exact: true })).toBeChecked();
  await expect(editor.getByRole("checkbox", { name: "Teams-Besprechung", exact: true })).toBeDisabled();
  await expect(editor.getByRole("link", { name: "Beitreten" })).toHaveAttribute("href", "https://teams.microsoft.com/l/meetup-join/example");
  await editor.getByPlaceholder("Beschreibung hinzufügen").fill("Descrição editada");
  await expect(editor.getByRole("button", { name: /Speichern/ })).toBeEnabled();
  await page.locator(".calendar-event-dialog").screenshot({ path: testInfo.outputPath("serie-exchange-teams.png") });
});

test.describe("criação e arraste no grid de 30 minutos", () => {
  test.use({ timezoneId:"Europe/Berlin" });
  for (const scenario of [{view:"day",advanced:false,hourHeight:60},{view:"week",advanced:true,hourHeight:68},{view:"workweek",advanced:true,hourHeight:84}]) {
    test(`seleção usa 30 minutos e card preserva minutos exatos: ${scenario.view}`, async ({page}) => {
      await page.clock.setFixedTime("2026-10-12T14:37:00+02:00");
      await installTauriMock(page,[],{calendarEvents:[{id:"grid-seed",title:"Existente",startsAt:"2026-10-12T12:00",endsAt:"2026-10-12T13:00",location:"",description:"",source:"DMH Backup",category:"",color:"blue"}]});
      await page.addInitScript(({view,advanced,hourHeight})=>{
        localStorage.setItem("dmh.calendar.advanced.v1",String(advanced));
        localStorage.setItem("agendakontakte.calendarView.v1",view);
        localStorage.setItem("agendakontakte.calendarAdvancedSettings.v1",JSON.stringify({hourHeight,hiddenSources:[]}));
      },scenario);
      await page.goto("/");await page.getByRole("button",{name:"Kalender",exact:true}).click();
      await page.evaluate(()=>{
        const w=window as any;const invoke=w.__TAURI_INTERNALS__.invoke;w.__DMH_EXACT_TIME_SAVES__=[];
        w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=>{if(command==="save_calendar_events")w.__DMH_EXACT_TIME_SAVES__.push(args.events);return invoke(command,args);};
      });
      const track=page.locator('[data-calendar-drop-kind="time"][data-calendar-day="2026-10-12"]');
      await expect(track).toBeVisible();
      const point=async(minutes:number)=>{
        const box=await track.boundingBox();if(!box)throw new Error("Grid não disponível");
        return {x:box.x+box.width*.65,y:box.y+(minutes/60)*scenario.hourHeight};
      };
      const click=await point(14*60+17);
      await page.mouse.move(click.x,click.y);await page.mouse.down();
      await expect(page.locator(".calendar-time-selection")).toContainText("14:30–15:00");
      await page.mouse.up();
      const editor=page.locator(".calendar-event-dialog");
      await expect(editor.getByLabel("Startzeit")).toHaveValue("14:30");await expect(editor.getByLabel("Endzeit")).toHaveValue("15:00");
      await editor.getByPlaceholder("Titel hinzufügen").fill("Minutos exatos");
      await editor.getByLabel("Startzeit").fill("14:17");await editor.getByLabel("Endzeit").fill("14:52");
      await editor.getByRole("button",{name:"Speichern",exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).__DMH_EXACT_TIME_SAVES__.length)).toBe(1);
      const saved=await page.evaluate(()=>(window as any).__DMH_EXACT_TIME_SAVES__[0][0]);
      expect(saved.startsAt).toBe("2026-10-12T14:17");expect(saved.endsAt).toBe("2026-10-12T14:52");
      const anchor=await point(13*60+44);const end=await point(13*60+7);
      await page.mouse.move(anchor.x,anchor.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});
      await expect(page.locator(".calendar-time-selection")).toContainText("13:00–13:30");await page.mouse.up();
      await expect(editor.getByLabel("Startzeit")).toHaveValue("13:00");await expect(editor.getByLabel("Endzeit")).toHaveValue("13:30");
    });

    test(`arraste para cima e para baixo usa 30 minutos e preserva duração: ${scenario.view}`, async ({ page }) => {
      await page.clock.setFixedTime("2026-10-12T14:37:00+02:00");
      await installTauriMock(page, [], { calendarEvents: [{ id: "drag-seed", title: "Arrastar existente", startsAt: "2026-10-12T12:00", endsAt: "2026-10-12T12:43", location: "", description: "", source: "DMH Backup", category: "", color: "blue" }] });
      await page.addInitScript(({ view, advanced, hourHeight }) => {
        localStorage.setItem("dmh.calendar.advanced.v1", String(advanced));
        localStorage.setItem("agendakontakte.calendarView.v1", view);
        localStorage.setItem("agendakontakte.calendarAdvancedSettings.v1", JSON.stringify({ hourHeight, hiddenSources: [] }));
      }, scenario);
      await page.goto("/");
      await page.getByRole("button", { name: "Kalender", exact: true }).click();
      await page.evaluate(() => {
        const w = window as any;
        const invoke = w.__TAURI_INTERNALS__.invoke;
        w.__DMH_DRAG_TIME_SAVES__ = [];
        w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
          if (command === "save_calendar_events") w.__DMH_DRAG_TIME_SAVES__.push(args.events);
          return invoke(command, args);
        };
      });
      const event = page.locator(".calendar-week-timed-event").filter({ hasText: "Arrastar existente" });
      const preview = page.locator(".calendar-event-drop-preview");
      const beginDrag = async () => {
        await event.scrollIntoViewIfNeeded();
        const box = await event.boundingBox();
        if (!box) throw new Error("Evento não disponível");
        const origin = { x: box.x + box.width / 2, y: box.y + scenario.hourHeight * 8 / 60 };
        await page.mouse.move(origin.x, origin.y);
        await page.mouse.down();
        return origin;
      };
      const down = await beginDrag();
      await page.mouse.move(down.x, down.y + scenario.hourHeight * 10 / 60, { steps: 3 });
      await expect(preview).toContainText("12:00–12:43");
      await page.mouse.move(down.x, down.y + scenario.hourHeight * 20 / 60, { steps: 3 });
      await expect(preview).toContainText("12:30–13:13");
      await page.mouse.up();
      await expect(event).toContainText("12:30–13:13");
      const up = await beginDrag();
      await page.mouse.move(up.x, up.y - scenario.hourHeight * 20 / 60, { steps: 3 });
      await expect(preview).toContainText("12:00–12:43");
      await page.mouse.up();
      await expect(event).toContainText("12:00–12:43");
      await expect.poll(() => page.evaluate(() => (window as any).__DMH_DRAG_TIME_SAVES__.length)).toBe(2);
      const saved = await page.evaluate(() => (window as any).__DMH_DRAG_TIME_SAVES__.map((events: CalendarEvent[]) => ({ startsAt: events[0].startsAt, endsAt: events[0].endsAt })));
      expect(saved).toEqual([
        { startsAt: "2026-10-12T12:30", endsAt: "2026-10-12T13:13" },
        { startsAt: "2026-10-12T12:00", endsAt: "2026-10-12T12:43" }
      ]);
      await expect(page.locator(".calendar-event-dialog")).toHaveCount(0);
    });
  }
});

test("mini calendário permite navegar por meses, semanas, ano e teclado sem perder a visualização", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-10-12T12:37:00Z") });
  await installTauriMock(page, [], { calendarEvents: [{ id:"mini-test",title:"Reunião",startsAt:"2026-10-12T14:00",endsAt:"2026-10-12T15:00",location:"",description:"",color:"blue",category:"",source:"Microsoft 365" }] });
  await page.addInitScript(() => { localStorage.setItem("dmh.calendar.advanced.v1","true");localStorage.setItem("agendakontakte.calendarView.v1","week"); });
  await page.goto("/");await page.getByRole("button",{name:"Kalender",exact:true}).click();
  const mini=page.locator(".calendar-mini");
  await expect(mini.getByRole("grid",{name:"Oktober 2026"})).toBeVisible();
  await expect(mini.getByRole("grid",{name:"November 2026"})).toBeVisible();
  await expect(page.getByLabel("Kalenderansicht")).toHaveValue("week");
  await page.mouse.move(1100,40);
  await page.screenshot({ path:testInfo.outputPath("mini-kalender-zwei-monate.png") });
  await mini.getByRole("button",{name:"Nächster Monat im Mini-Kalender"}).click();
  await expect(mini.getByRole("grid",{name:"Dezember 2026"})).toBeVisible();
  await expect(page.locator(".calendar-toolbar")).toContainText("Woche 42");
  await mini.getByRole("grid",{name:"November 2026"}).getByRole("button",{name:"Donnerstag, 12. November 2026"}).click();
  await expect(page.getByLabel("Kalenderansicht")).toHaveValue("week");
  await expect(page.locator(".calendar-toolbar")).toContainText("Woche 46");
  await mini.getByRole("grid",{name:"November 2026"}).getByRole("button",{name:"Donnerstag, 12. November 2026"}).press("ArrowRight");
  await expect(mini.locator("button.selected[data-in-month='true']")).toHaveAttribute("data-date","2026-11-13");
  await mini.getByRole("button",{name:"Monat und Jahr auswählen, November 2026"}).click();
  await mini.getByRole("spinbutton",{name:"Jahr"}).fill("2020");
  await mini.getByRole("button",{name:"Dez"}).click();
  await mini.getByRole("grid",{name:"Januar 2021"}).getByRole("button",{name:"Kalenderwoche 53 auswählen, ab Montag, 28. Dezember 2020"}).click();
  await expect(page.locator(".calendar-toolbar")).toContainText("Woche 53");
  await mini.getByRole("button",{name:"Heute",exact:true}).click();
  await expect(page.locator(".calendar-toolbar")).toContainText("Woche 42");
  await page.getByRole("button",{name:"Kalendernavigation einklappen"}).click();
  await expect(mini).toHaveCount(0);
  await expect(page.locator(".advanced-calendar-shell")).toHaveClass(/navigation-collapsed/);
  await page.getByRole("button",{name:"Kalendernavigation ausklappen"}).click();
  await expect(page.locator(".advanced-calendar-source-list")).toBeVisible();
  await page.setViewportSize({width:800,height:900});
  await page.locator(".advanced-calendar-navigation").screenshot({ path:testInfo.outputPath("mini-kalender-klein.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("menu de contexto mantém os ícones alinhados à esquerda e as setas à direita", async ({ page }, testInfo) => {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await installTauriMock(page, [], { calendarEvents: [{
    id: "context-menu-layout-test",
    title: "Teste visual",
    startsAt: `${day}T13:00:00`,
    endsAt: `${day}T14:00:00`,
    location: "",
    description: "",
    color: "blue",
    category: "",
    source: "DMH Backup"
  }] });
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByLabel("Kalenderansicht").selectOption("month");
  await page.getByRole("button", { name: /Teste visual/ }).click({ button: "right" });

  const menu = page.getByRole("menu", { name: /Aktionen für Teste visual/ });
  await expect(menu).toBeVisible();
  const iconPositions = await menu.locator(":scope > button > svg:first-child").evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().left));
  expect(iconPositions).toHaveLength(10);
  expect(Math.max(...iconPositions) - Math.min(...iconPositions)).toBeLessThan(2);
  const symbol = menu.getByRole("menuitem", { name: "Symbol" });
  const firstIcon = await symbol.locator("svg:first-child").boundingBox();
  const chevron = await symbol.locator(".calendar-event-context-chevron").boundingBox();
  expect(firstIcon).not.toBeNull();
  expect(chevron).not.toBeNull();
  expect(chevron!.x).toBeGreaterThan(firstIcon!.x + 150);
  await page.screenshot({ path: testInfo.outputPath("calendar-context-menu.png") });
});

test("evento Microsoft 365 sem título não aparece apenas como horário", async ({ page }) => {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await installTauriMock(page, [], { calendarEvents: [{
    id: "m365:calendar-a:event-without-subject",
    title: "",
    startsAt: `${day}T12:00:00`,
    endsAt: `${day}T13:00:00`,
    location: "",
    description: "",
    color: "blue",
    category: "",
    source: "Microsoft 365 · Calendário"
  }] });
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByLabel("Kalenderansicht").selectOption("month");

  await expect(page.getByRole("button", { name: /Titel in Microsoft 365 nicht verfügbar/ })).toBeVisible();
});

test("o cartão de importação não cobre Neuer Termin em janelas grandes ou pequenas", async ({ page }) => {
  await installTauriMock(page, []);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 760, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Kalender", exact: true }).click();
    const newEvent = page.getByRole("button", { name: /Neuer Termin/ });
    const card = page.locator(".calendar-empty .first-import");
    await expect(card).toBeVisible();
    const buttonBox = await newEvent.boundingBox();
    const cardBox = await card.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height + 8);
    if (viewport.height >= 900) {
      expect(cardBox!.y).toBeLessThanOrEqual(200);
    }
    await newEvent.click();
    await expect(page.getByPlaceholder("Titel hinzufügen")).toBeVisible();
  }
});

test("o cartão de importação não cobre Neuer Kontakt em janelas grandes ou pequenas", async ({ page }) => {
  await installTauriMock(page, []);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 760, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Kontakte", exact: true }).click();
    const newContact = page.getByRole("button", { name: /Neuer Kontakt/ });
    const card = page.locator(".contacts-empty .first-import");
    await expect(card).toBeVisible();
    const buttonBox = await newContact.boundingBox();
    const cardBox = await card.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height + 8);
    if (viewport.height >= 900) {
      expect(cardBox!.y).toBeLessThanOrEqual(200);
    }
    await newContact.click();
    await expect(page.getByRole("dialog", { name: "Neuen Kontakt anlegen" })).toBeVisible();
  }
});

test("abas aguardam os dados antes de mostrar o estado vazio", async ({ page }) => {
  await installTauriMock(page, [], { loadDelayMs: 250 });
  await page.goto("/");

  await page.getByRole("button", { name: "Kontakte", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Kontakte werden geladen …");
  await expect(page.getByRole("heading", { name: "Noch keine Kontakte" })).toHaveCount(0);
  await expect(page.locator(".contacts-empty .first-import")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Noch keine Kontakte" })).toBeVisible();

  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await expect(page.getByText("Kalender wird geladen …", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Noch keine Termine" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Noch keine Termine" })).toBeVisible();
});


test("gerenciador de categorias permite buscar e selecionar em janelas menores", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.addInitScript(() => localStorage.setItem("agendakontakte.calendarCategories", JSON.stringify(
    Array.from({ length: 35 }, (_, index) => ({ name: `Kategorie ${String(index + 1).padStart(2, "0")}`, color: index % 2 ? "blue" : "green" }))
  )));
  await page.goto("/");
  await page.getByRole("button", { name: "Kalender", exact: true }).click();
  await page.getByRole("button", { name: "Weitere Kalenderaktionen" }).click();
  await page.getByRole("button", { name: "Kategorien verwalten", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Kategorien verwalten", exact: true });
  await expect(dialog.getByText("35 Kategorien", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Ohne Kategorie: Blau", { exact: true })).toBeVisible();
  await dialog.getByRole("searchbox", { name: "Kategorien suchen" }).fill("Kategorie 3");
  await expect(dialog.locator(".category-manager-list > li")).toHaveCount(6);
  await dialog.getByRole("checkbox", { name: "Alle angezeigten Kategorien auswählen" }).check();
  await expect(dialog.getByText("6 ausgewählt", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Auswahl löschen" })).toBeEnabled();
  await dialog.locator(".calendar-category-manager-card").screenshot({ path: testInfo.outputPath("categorias-desktop.png") });
  for (const width of [760, 520]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    expect(await dialog.locator(".category-manager-list").evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await expect(dialog.getByRole("button", { name: "Kategorie anlegen" })).toBeVisible();
  }
});
