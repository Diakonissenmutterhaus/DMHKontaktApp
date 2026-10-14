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

test("M365 Anmeldung usa conta Windows, permite escolher outra e mantém o login fora da sincronização automática", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.addInitScript(() => {
    const w = window as any;
    const original = w.__TAURI_INTERNALS__.invoke;
    const calls: string[] = [];
    w.__DMH_LOGIN_CALLS__ = calls;
    let connected = false;
    const account = { id: "one", displayName: "Anna Windows", email: "anna@example.test", userPrincipalName: "anna@example.test", connectedAt: "2026-10-13T12:00:00Z" };
    const settings: Record<string, string> = { m365_complete_automatic_sync_initialized_v1: "true" };
    w.__TAURI_INTERNALS__.invoke = async (command: string, args: any) => {
      if (["connect_m365_with_windows_account", "start_m365_interactive_connection", "disconnect_m365_account", "test_m365_connection"].includes(command)) calls.push(command);
      if (command === "get_m365_connection_status") return { configured: true, connected, account: connected ? account : null };
      if (command === "get_app_setting") return settings[args.key] ?? null;
      if (command === "set_app_setting") { settings[args.key] = args.value; return null; }
      if (command === "list_m365_sync_sources") return { contacts: [], calendars: [], warnings: [] };
      if (command === "connect_m365_with_windows_account" || command === "start_m365_interactive_connection") {
        await new Promise(resolve => window.setTimeout(resolve, 300)); connected = true; return account;
      }
      if (command === "test_m365_connection") return { configured: true, connected: true, account };
      if (command === "disconnect_m365_account") { connected = false; return null; }
      return original(command, args);
    };
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("button", { name: "M365 Anmeldung", exact: true }).click();
  const connect = page.getByRole("button", { name: "Mit Microsoft 365 verbinden", exact: true });
  await expect(connect).toBeVisible();
  expect(await page.evaluate(() => (window as any).__DMH_LOGIN_CALLS__)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("windows-login.png"), fullPage: true });
  await connect.click();
  await expect(page.getByRole("button", { name: "Microsoft-Anmeldung läuft …", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Anna Windows" })).toBeVisible();
  await page.getByRole("button", { name: "Verbindung prüfen" }).click();
  expect(await page.evaluate(() => (window as any).__DMH_LOGIN_CALLS__)).toEqual(["connect_m365_with_windows_account", "test_m365_connection"]);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Konto trennen" }).click();
  await page.getByRole("button", { name: "Anderes Konto verwenden" }).click();
  await expect(page.getByRole("heading", { name: "Anna Windows" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__DMH_LOGIN_CALLS__)).toEqual(["connect_m365_with_windows_account", "test_m365_connection", "disconnect_m365_account", "start_m365_interactive_connection"]);
});

test("importação distingue caixas IMAP e Exchange com o mesmo endereço e copia somente a selecionada", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.addInitScript(() => {
    const w = window as any, invoke = w.__TAURI_INTERNALS__.invoke;
    const address = "same@example.test";
    let copied = false;
    w.__EMAIL_SOURCE_SELECTIONS__ = [];
    const sources = [
      { id:"exchange-store", name:address, kind:"outlook", accountKind:"Exchange", path:"C:\\fixture\\exchange.ost" },
      { id:"imap-store", name:address, kind:"outlook", accountKind:"IMAP", path:"" }
    ];
    const folders = [
      { id:"exchange-inbox", sourceId:"exchange-store", name:"Inbox", path:`${address}/Inbox`, source:"outlook", accountKind:"Exchange", count:1 },
      { id:"imap-inbox", sourceId:"imap-store", name:"Inbox", path:`${address}/Inbox`, source:"outlook", accountKind:"IMAP", count:1 },
      { id:"imap-work", sourceId:"imap-store", name:"Work", path:`${address}/Inbox/Work`, source:"outlook", accountKind:"IMAP", count:1 }
    ];
    const messages = [
      { id:"exchange-mail", folderId:"exchange-inbox", subject:"Exchange existing mail" },
      { id:"imap-mail", folderId:"imap-inbox", subject:"IMAP saved mail" },
      { id:"imap-work-mail", folderId:"imap-work", subject:"IMAP subfolder mail" }
    ].map(message => ({ ...message, sender:"Sender", recipient:address, cc:"", date:"2026-10-14T12:00:00Z", body:"Local copy", html:"", attachments:[], large:false }));
    w.__TAURI_INTERNALS__.invoke = (command:string, args:any) => {
      if (command === "scan_local_email_sources") return Promise.resolve({sources,folders,issues:[],archivePath:"C:\\fixture\\archive"});
      if (command === "get_local_email_copy_status") return Promise.resolve({running:false,progress:"",result:null,failed:false});
      if (command === "copy_local_emails") { copied=true; w.__EMAIL_SOURCE_SELECTIONS__.push(args.sourceIds); return Promise.resolve({copied:2,folders:2,issues:[],completedAt:"2026-10-14T12:00:00Z"}); }
      if (command === "list_email_archive_folders") return Promise.resolve(copied ? folders : folders.slice(0,1));
      if (command === "list_email_archive_messages") {
        const matches = (copied ? messages : messages.slice(0,1)).filter(message => !args.query.folderId || message.folderId === args.query.folderId);
        return Promise.resolve({items:matches,total:matches.length});
      }
      if (command === "read_email_archive_message") return Promise.resolve(messages.find(message => message.id === args.id));
      if (command === "get_email_archive_folder_preferences") return Promise.resolve({});
      if (command === "list_email_archive_categories" || command === "list_email_archive_attachments") return Promise.resolve([]);
      if (command === "get_email_archive_removed_count") return Promise.resolve(0);
      return invoke(command,args);
    };
  });
  await page.goto("/");
  await page.getByRole("navigation", {name:"Hauptmenü"}).getByRole("button", {name:"emails speichern",exact:true}).click();
  const exchange = page.getByRole("checkbox", {name:"same@example.test · Outlook · Exchange"});
  const imap = page.getByRole("checkbox", {name:"same@example.test · Outlook · IMAP"});
  await expect(exchange).toBeChecked();
  await expect(imap).toBeChecked();
  await page.getByRole("button", {name:"Auswahl aufheben",exact:true}).click();
  await imap.check();
  await expect(exchange).not.toBeChecked();
  await page.screenshot({path:testInfo.outputPath("imap-exchange-selection.png")});
  await page.getByRole("button", {name:"Alle E-Mails der Auswahl lokal kopieren"}).click();
  await expect(page.getByText(/2 Nachrichten kopiert/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__EMAIL_SOURCE_SELECTIONS__)).toEqual([["imap-store"]]);
  await page.getByRole("tab", {name:/E-Mails lesen/}).click();
  const archive = page.getByRole("tree", {name:"Archivordnerstruktur"});
  await expect(archive.getByRole("treeitem", {name:"same@example.test · Outlook · Exchange 1"})).toBeVisible();
  await expect(archive.getByRole("treeitem", {name:"same@example.test · Outlook · IMAP 2"})).toBeVisible();
  const list = page.getByRole("listbox", {name:"Archivierte Nachrichten"});
  await expect(list.getByRole("option")).toHaveCount(3);
  await list.getByText("IMAP saved mail").click();
  await expect(page.getByRole("heading", {name:"IMAP saved mail"})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("imap-exchange-archive.png")});
});

test("abas gerais M365 Anmeldung e emails speichern abrem conexão e arquivo local somente leitura", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.addInitScript(() => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    let copied = false;
    let copyRunning = false;
    let copyResult: any = null;
    const pdfObjects = [
      "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.pdfExecuted=true;) >> >>",
      "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>",
      "", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Annot /Subtype /Link /Rect [0 0 300 200] /A << /S /URI /URI (https://tracker.example/pdf) >> >>"
    ];
    for (const [index, number] of [[3,1],[5,2]]) {
      const stream = `BT /F1 16 Tf 30 150 Td (Attachment preview page ${number}) Tj ET`;
      pdfObjects[index] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    }
    let pdf = "%PDF-1.7\n"; const positions = [0];
    pdfObjects.forEach((object,index) => { positions.push(pdf.length); pdf += `${index+1} 0 obj\n${object}\nendobj\n`; });
    const xref = pdf.length; pdf += `xref\n0 ${positions.length}\n0000000000 65535 f \n`;
    pdf += positions.slice(1).map(position => `${String(position).padStart(10,"0")} 00000 n \n`).join("");
    pdf += `trailer\n<< /Size ${positions.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const image = document.createElement("canvas"); image.width = 128; image.height = 96;
    const imageContext = image.getContext("2d")!; imageContext.fillStyle = "#8e103b"; imageContext.fillRect(0,0,128,96);
    const imageBase64 = image.toDataURL("image/png").split(",")[1];
    const attachmentFixtures = [
      { index:0,name:"agenda.pdf",size:pdf.length,mimeType:"application/pdf",preview:"pdf",available:true },
      { index:1,name:"foto.png",size:100,mimeType:"image/png",preview:"image",available:true }
    ];
    w.__DMH_EMAIL_ARCHIVE_CALLS__ = [];
    const messages = Array.from({ length: 105 }, (_, index) => ({ id: `mail-${index}`, folderId: index < 101 ? "inbox" : "archive", subject: index === 0 ? "Mensagem HTML" : `Mensagem ${index}`, sender: "Anna <anna@example.test>", recipient: "Julius <julius@example.test>", cc: "", date: "2026-10-13T12:00:00Z", body: index === 0 ? "" : `Conteúdo local ${index}`, html: index === 0 ? '<p>Conteúdo salvo offline</p><img src="https://tracker.example/pixel"><script>window.emailExecuted=true</script>' : "", attachments: index === 0 ? ["agenda.pdf"] : [], large: false }));
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (command.includes("email_archive") || command === "copy_local_emails" || command === "scan_local_email_sources") w.__DMH_EMAIL_ARCHIVE_CALLS__.push({ command, args });
      if (command === "scan_local_email_sources") return Promise.resolve({ sources: [{ id: "tb", name: "Thunderbird · Local Folders", kind: "thunderbird", path: "C:\\fixture\\Thunderbird" }, { id: "ol", name: "Outlook Classic · Julius", kind: "outlook", path: "C:\\fixture\\Outlook.pst" }], folders: [{ id: "p-inbox", sourceId: "tb", name: "Inbox", path: "Thunderbird · Local Folders/Inbox", source: "thunderbird" }, { id: "p-work", sourceId: "tb", name: "Work", path: "Thunderbird · Local Folders/Inbox/Work", source: "thunderbird" }], archivePath: "C:\\fixture\\email-archive", issues: [] });
      if (command === "get_local_email_copy_status") return Promise.resolve({ running: copyRunning, progress: copyRunning ? "Thunderbird · Local Folders" : "", result: copyResult, failed: false });
      if (command === "copy_local_emails") {
        copyRunning = true;
        return new Promise(resolve => window.setTimeout(() => { copied = true; copyRunning = false; copyResult = { copied: 105, folders: 2, issues: [], completedAt: "2026-10-13T12:00:00Z" }; resolve(copyResult); }, 1500));
      }
      if (command === "list_email_archive_folders") return Promise.resolve(copied ? [{ id: "inbox", name: "Inbox", path: "Thunderbird/Inbox", source: "thunderbird", count: 101 }, { id: "archive", name: "Archiv", path: "Outlook/Archiv", source: "outlook", count: 4 }] : []);
      if (command === "list_email_archive_messages") {
        const query = args.query;
        const filtered = copied ? messages.filter(message => (!query.folderId || message.folderId === query.folderId) && `${message.subject} ${message.sender} ${message.recipient}`.toLowerCase().includes(query.search.toLowerCase())) : [];
        return Promise.resolve({ items: filtered.slice(query.offset, query.offset + 100).map(message => ({ ...message, body: "", html: "" })), total: filtered.length });
      }
      if (command === "read_email_archive_message") return Promise.resolve(messages.find(message => message.id === args.id));
      if (command === "list_email_archive_attachments") return Promise.resolve(args.id === "mail-0" ? attachmentFixtures : []);
      if (command === "read_email_archive_attachment") return Promise.resolve({ attachment:attachmentFixtures[args.index],base64:args.index === 0 ? btoa(pdf) : imageBase64 });
      if (command === "plugin:dialog|save") return Promise.resolve("C:\\fixture\\saved-attachment.pdf");
      if (command === "save_email_archive_attachment") return Promise.resolve(null);
      return invoke(command, args);
    };
  });
  const trackingRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("tracker.example")) trackingRequests.push(request.url()); });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptmenü" });
  await nav.getByRole("button", { name: "M365 Anmeldung", exact: true }).click();
  await expect(page.getByRole("heading", { name: "M365 Anmeldung", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /EDV/ })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Unterseiten der EDV Tools" })).toHaveCount(0);
  await nav.getByRole("button", { name: "emails speichern", exact: true }).click();
  await expect(page.getByRole("heading", { name: "emails speichern", exact: true })).toBeVisible();
  await expect(page.getByText("Nur Lesen", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Thunderbird · Local Folders" })).toBeChecked();
  await expect(page.getByRole("tab", { name: "Importieren", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("listbox", { name: "Archivierte Nachrichten" })).toBeHidden();
  await page.getByRole("tree", { name: "Quellordner" }).getByRole("button", { name: "Inbox aufklappen" }).click();
  await expect(page.getByRole("tree", { name: "Quellordner" }).getByText("Work", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("emails-importieren-desktop.png") });
  expect(await page.evaluate(() => (window as any).__DMH_EMAIL_ARCHIVE_CALLS__.filter((call: any) => call.command === "copy_local_emails").length)).toBe(0);
  await page.getByRole("button", { name: "Alle E-Mails der Auswahl lokal kopieren" }).click();
  await expect(page.getByRole("button", { name: "E-Mails werden kopiert …", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: /E-Mails lesen/ }).click();
  await expect(page.getByRole("region", { name: "Lokale E-Mail-Quellen" })).toBeHidden();
  await page.getByRole("tab", { name: "Importieren", exact: true }).click();
  await nav.getByRole("button", { name: "M365 Anmeldung", exact: true }).click();
  await nav.getByRole("button", { name: "emails speichern", exact: true }).click();
  await expect(page.getByRole("button", { name: "E-Mails werden kopiert …", exact: true })).toBeDisabled();
  await expect(page.getByText(/105 Nachrichten kopiert/)).toBeVisible();
  await page.getByRole("tab", { name: /E-Mails lesen/ }).click();
  await expect(page.getByRole("listbox", { name: "Archivierte Nachrichten" }).getByRole("option")).toHaveCount(100);
  await page.getByRole("button", { name: "Nächste Nachrichtenseite" }).click();
  await expect(page.getByRole("listbox", { name: "Archivierte Nachrichten" }).getByRole("option")).toHaveCount(5);
  await page.getByRole("tree", { name: "Archivordnerstruktur" }).getByRole("treeitem", { name: "Inbox 101", exact: true }).click();
  await page.getByRole("searchbox", { name: "Archivierte E-Mails suchen" }).fill("Mensagem HTML");
  const list = page.getByRole("listbox", { name: "Archivierte Nachrichten" });
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").click();
  const reader = page.getByRole("article", { name: "E-Mail lesen" });
  await expect(reader).toContainText("Conteúdo salvo offline");
  await expect(reader).toContainText("agenda.pdf");
  await reader.getByRole("button", { name: "agenda.pdf anzeigen", exact:true }).click();
  const pdfDialog = page.getByRole("dialog", { name: "Anhang: agenda.pdf" });
  await expect(pdfDialog).toBeVisible();
  await expect(pdfDialog.getByText("Seite 1 von 2", { exact:true })).toBeVisible();
  await expect(pdfDialog.getByRole("status")).toHaveCount(0);
  await expect(pdfDialog.getByRole("alert"), JSON.stringify(await page.evaluate(() => (window as any).__DMH_TEST_DIAGNOSTICS__.filter((entry:any) => entry.origin === "LocalPdfPreview")))).toHaveCount(0);
  await expect(pdfDialog.locator("canvas")).toBeVisible();
  expect(await pdfDialog.locator("canvas").evaluate((element:HTMLCanvasElement) => element.width > 0 && element.height > 0)).toBe(true);
  await pdfDialog.getByRole("button", { name:"Nächste PDF-Seite" }).click();
  await expect(pdfDialog.getByText("Seite 2 von 2", { exact:true })).toBeVisible();
  await pdfDialog.getByRole("button", { name:"PDF vergrößern" }).click();
  await expect(pdfDialog.getByText("125%", { exact:true })).toBeVisible();
  await expect(pdfDialog.getByRole("status")).toHaveCount(0);
  await expect(pdfDialog.getByRole("alert")).toHaveCount(0);
  await expect(pdfDialog.locator("canvas")).toBeVisible();
  const renderedPixels = await pdfDialog.locator("canvas").evaluate((element:HTMLCanvasElement) => {
    const pixels = element.getContext("2d")!.getImageData(0,0,element.width,element.height).data;
    let opaque = 0, dark = 0; for (let index=0;index<pixels.length;index+=4) { if (pixels[index+3]>0) opaque++; if (pixels[index]<100 && pixels[index+1]<100 && pixels[index+2]<100 && pixels[index+3]>0) dark++; }
    return { opaque,dark };
  });
  expect(renderedPixels.opaque).toBeGreaterThan(1000);
  expect(renderedPixels.dark).toBeGreaterThan(20);
  await page.screenshot({ path:testInfo.outputPath("email-attachment-pdf.png") });
  await pdfDialog.getByRole("button", { name:"Anhang schließen" }).click();
  await reader.getByRole("button", { name:"foto.png anzeigen", exact:true }).click();
  const imageDialog = page.getByRole("dialog", { name:"Anhang: foto.png" });
  await expect(imageDialog.getByRole("img", { name:"foto.png" })).toBeVisible();
  expect(await imageDialog.locator("img").evaluate((element:HTMLImageElement) => element.naturalWidth)).toBe(128);
  await imageDialog.getByRole("button", { name:"Speichern unter", exact:true }).click();
  await expect(imageDialog.getByRole("status")).toContainText("als Kopie gespeichert");
  await page.keyboard.press("Escape");
  await expect(imageDialog).toBeHidden();
  const attachmentSaves = await page.evaluate(() => (window as any).__DMH_EMAIL_ARCHIVE_CALLS__.filter((call:any) => call.command === "save_email_archive_attachment"));
  expect(attachmentSaves).toEqual([{ command:"save_email_archive_attachment",args:{ id:"mail-0", index:1, path:"C:\\fixture\\saved-attachment.pdf" } }]);
  expect(await page.evaluate(() => (window as any).pdfExecuted)).toBeUndefined();
  await expect(reader.locator("img,iframe,script,form,textarea")).toHaveCount(0);
  await page.getByRole("button", { name: "Lesebereich erweitern", exact: true }).click();
  await expect(list).toBeHidden();
  await page.getByRole("button", { name: "Lesebereich wiederherstellen", exact: true }).click();
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: "Lesebereich rechts", exact: true }).click();
  await expect(page.locator(".email-reader-main")).toHaveClass(/reader-right/);
  await page.getByRole("button", { name: "Lesebereich unten", exact: true }).click();
  await page.getByRole("button", { name: "Ordnerleiste ausblenden", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Archivordner" })).toBeHidden();
  await page.getByRole("button", { name: "Ordnerleiste einblenden", exact: true }).click();
  expect(trackingRequests).toEqual([]);
  expect(await page.evaluate(() => (window as any).emailExecuted)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("emails-speichern-desktop.png") });
  await page.setViewportSize({ width: 800, height: 900 });
  expect(await page.locator(".email-save-page").evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("emails-speichern-klein.png") });
  await nav.getByRole("button", { name: "M365 Anmeldung", exact: true }).click();
  await nav.getByRole("button", { name: "emails speichern", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Archivierte Nachrichten" }).getByRole("option")).toHaveCount(100);
  const copies = await page.evaluate(() => (window as any).__DMH_EMAIL_ARCHIVE_CALLS__.filter((call: any) => call.command === "copy_local_emails"));
  expect(copies).toHaveLength(1);
  expect(copies[0].args.sourceIds).toEqual(["tb", "ol"]);
  await page.getByRole("button", { name: "EDV Tools", exact: true }).click();
  await expect(page.getByLabel("EDV-Kennwort", { exact: true })).toBeVisible();
});

test("arquivo de emails combina busca, período, anexos e ordenação antes da paginação", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z"));
  await page.addInitScript(() => {
    const w = window as any;
    localStorage.setItem("dmh-email-archive-tab", "read");
    const original = w.__TAURI_INTERNALS__.invoke;
    const base = { recipient:"Julius", cc:"", body:"Texto local", html:"", attachments:[] as string[], large:false };
    const messages = [
      ...Array.from({ length:105 }, (_, index) => ({ ...base, id:`batch-${String(index).padStart(3,"0")}`, folderId:"inbox", subject:`Batch ${index}`, sender:"Anna", date:new Date(2026,9,10,8,index).toISOString() })),
      { ...base, id:"today-a",folderId:"inbox",subject:"Überblick 100%_final",sender:"Zoe",cc:"MÜLLER@example.test",date:new Date(2026,9,14,12).toISOString(),attachments:["PrÜfung.pdf"] },
      { ...base, id:"today-b",folderId:"archive",subject:"Angebot",sender:"Bernd",cc:"MÜLLER@example.test",date:new Date(2026,9,14,10).toISOString() },
      { ...base, id:"yesterday",folderId:"archive",subject:"Gestern spät",sender:"Cora",date:new Date(2026,9,13,23,59).toISOString(),attachments:["foto.jpg"] },
      { ...base, id:"tomorrow",folderId:"archive",subject:"Morgen",sender:"Dora",date:new Date(2026,9,15).toISOString() },
      { ...base, id:"undated",folderId:"archive",subject:"Ohne Datum",sender:"Elsa",date:"" }
    ];
    w.__EMAIL_FILTER_QUERIES__ = [];
    w.__TAURI_INTERNALS__.invoke = (command:string, args:any) => {
      if (command === "scan_local_email_sources") return Promise.resolve({ sources:[],issues:[] });
      if (command === "get_local_email_copy_status") return Promise.resolve(null);
      if (command === "list_email_archive_folders") return Promise.resolve([
        { id:"inbox",name:"Inbox",path:"Account/Inbox",source:"thunderbird",count:106 },
        { id:"archive",name:"Archiv",path:"Account/Archiv",source:"thunderbird",count:4 }
      ]);
      if (command === "list_email_archive_messages") {
        const q = args.query; w.__EMAIL_FILTER_QUERIES__.push(q);
        const items = messages.filter(m => (!q.folderId || q.folderId===m.folderId)
          && `${m.subject} ${m.sender} ${m.recipient} ${m.cc} ${m.attachments.join(" ")}`.toLowerCase().includes(q.search.trim().toLowerCase())
          && (!q.fromAt || Date.parse(m.date)>=Date.parse(q.fromAt))
          && (!q.beforeAt || Date.parse(m.date)<Date.parse(q.beforeAt)) && (!q.attachmentsOnly || m.attachments.length>0));
        items.sort((a,b) => {
          if (["subject", "subjectDesc", "sender", "senderDesc"].includes(q.sort)) {
            const key = q.sort.startsWith("subject") ? "subject" : "sender";
            return a[key].toLowerCase().localeCompare(b[key].toLowerCase()) * (q.sort.endsWith("Desc") ? -1 : 1);
          }
          if (!a.date || !b.date) return !a.date ? 1 : -1;
          return (Date.parse(a.date)-Date.parse(b.date))*(q.sort === "oldest" ? 1 : -1) || a.id.localeCompare(b.id);
        });
        return Promise.resolve({ items:items.slice(q.offset,q.offset+100),total:items.length });
      }
      if (command === "read_email_archive_message") return Promise.resolve(messages.find(m => m.id===args.id));
      if (command === "list_email_archive_attachments") return Promise.resolve([]);
      return original(command,args);
    };
  });
  await page.goto("/");
  await page.getByRole("navigation", { name:"Hauptmenü" }).getByRole("button", { name:"emails speichern",exact:true }).click();
  const list = page.getByRole("listbox", { name:"Archivierte Nachrichten" });
  await expect(list.getByRole("option")).toHaveCount(100);
  await expect(list.getByRole("option").first()).toContainText("Morgen");
  await page.getByRole("button", { name:"Nächste Nachrichtenseite" }).click();
  await expect(list.getByRole("option")).toHaveCount(10);
  const dateHeader = page.getByRole("button", { name:"Nach Datum sortieren",exact:true });
  const subjectHeader = page.getByRole("button", { name:"Nach Betreff sortieren",exact:true });
  const senderHeader = page.getByRole("button", { name:"Nach Von sortieren",exact:true });
  await dateHeader.click();
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("oldest");
  await expect(list.getByRole("option")).toHaveCount(100);
  await expect(list.getByRole("option").first()).toContainText("Batch 0");
  await dateHeader.click();
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("newest");
  await expect(list.getByRole("option").first()).toContainText("Morgen");
  await list.getByRole("option").first().click();
  const openMail = page.getByRole("article", { name:"E-Mail lesen" });
  await expect(openMail.getByRole("heading", { name:"Morgen",exact:true })).toBeVisible();
  await subjectHeader.click();
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("subject");
  await expect(list.getByRole("option").first()).toContainText("Angebot");
  await subjectHeader.click();
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("subjectDesc");
  await expect(list.getByRole("option").first()).toContainText("Überblick");
  await expect(subjectHeader).toHaveAttribute("aria-pressed", "true");
  await senderHeader.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("sender");
  await expect(list.getByRole("option").first()).toContainText("Batch");
  await page.keyboard.press("Space");
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("senderDesc");
  await expect(list.getByRole("option").first()).toContainText("Überblick");
  await expect(subjectHeader).toHaveAttribute("aria-pressed", "false");
  await expect(openMail.getByRole("heading", { name:"Morgen",exact:true })).toBeVisible();
  await page.screenshot({ path:testInfo.outputPath("email-sort-headers.png") });
  await page.getByRole("combobox", { name:"E-Mails sortieren" }).selectOption("oldest");
  await expect(list.getByRole("option")).toHaveCount(100);
  await expect(list.getByRole("option").first()).toContainText("Batch 0");
  await page.getByRole("treeitem", { name:"Inbox 106",exact:true }).click();
  const search = page.getByRole("searchbox", { name:"Archivierte E-Mails suchen" });
  await search.fill("müller");
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").click();
  await expect(page.getByRole("article", { name:"E-Mail lesen" })).toContainText("Überblick");
  await page.getByRole("combobox", { name:"Suchbereich" }).selectOption("all");
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("article", { name:"E-Mail lesen" })).toContainText("Eine archivierte Nachricht");
  await search.fill("prüfung.pdf");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option")).toContainText("Überblick");
  await page.getByRole("button", { name:"Zurücksetzen",exact:true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("combobox", { name:"Suchbereich" })).toHaveValue("folder");
  await expect(page.getByRole("combobox", { name:"E-Mails sortieren" })).toHaveValue("newest");
  await page.getByRole("combobox", { name:"Suchbereich" }).selectOption("all");
  await page.getByRole("button", { name:"Filter",exact:true }).click();
  await page.getByRole("combobox", { name:"E-Mail-Zeitraum" }).selectOption("today");
  await expect(list.getByRole("option")).toHaveCount(2);
  await page.getByRole("checkbox", { name:"Nur mit Anhang" }).check();
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").click();
  await page.getByRole("button", { name:"Details einblenden" }).click();
  await expect(page.getByRole("article", { name:"E-Mail lesen" })).toContainText("Account/Inbox");
  await page.screenshot({ path:testInfo.outputPath("email-filters-desktop.png") });
  await page.getByLabel("E-Mails ab Datum", { exact:true }).fill("2026-10-15");
  await expect(page.getByText("Bitte einen gültigen Zeitraum wählen: Von darf nicht nach Bis liegen.")).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(0);
  await page.getByLabel("E-Mails ab Datum", { exact:true }).fill("2026-10-13");
  await expect(list.getByRole("option")).toHaveCount(2);
  const latestQuery = await page.evaluate(() => (window as any).__EMAIL_FILTER_QUERIES__.at(-1));
  expect(latestQuery).toMatchObject({ folderId:null,attachmentsOnly:true,offset:0,sort:"newest" });
  await page.getByRole("checkbox", { name:"Nur mit Anhang" }).uncheck();
  await expect(list.getByRole("option")).toHaveCount(3);
  await search.fill("Angebot");
  await expect(list.getByRole("option")).toHaveCount(1);
  await list.getByRole("option").click();
  await page.getByRole("button", { name:"Lesebereich rechts",exact:true }).click();
  await expect(page.getByRole("article", { name:"E-Mail lesen" })).toContainText("Angebot");
  await expect(list).toBeVisible();
  await page.getByRole("button", { name:"Lesebereich unten",exact:true }).click();
  await page.setViewportSize({ width:800,height:900 });
  expect(await page.locator(".email-save-page").evaluate(element => element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await page.screenshot({ path:testInfo.outputPath("email-filters-klein.png") });
  await page.getByRole("button", { name:"Zurücksetzen",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(100);
  await search.fill("not found");
  await expect(page.getByText("Keine Nachricht gefunden.", { exact:true })).toBeVisible();
  await page.getByRole("button", { name:"Zurücksetzen",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(100);
});

test("caixas postais têm menu contextual reversível e barra lateral compacta com hover", async ({ page }, testInfo) => {
  await installTauriMock(page, []);
  await page.addInitScript(() => {
    const w = window as any; localStorage.setItem("dmh-email-archive-tab","read");
    const original = w.__TAURI_INTERNALS__.invoke;
    const folders = [
      { id:"inbox",name:"Posteingang",path:"julius@example.test/Posteingang",source:"outlook",sourceId:"a",count:1,importedOrder:1,sortKey:"10" },
      { id:"work",name:"Arbeit",path:"julius@example.test/Posteingang/Arbeit",source:"outlook",sourceId:"a",count:1,importedOrder:2,sortKey:"00" },
      { id:"archive",name:"Archiv",path:"julius@example.test/Archiv",source:"outlook",sourceId:"a",count:1,importedOrder:3,sortKey:"20" },
      { id:"other",name:"Posteingang",path:"info@example.test/Posteingang",source:"outlook",sourceId:"b",count:1,importedOrder:4,sortKey:"10" }
    ];
    const messages = folders.map((folder,index) => ({ id:`mail-${index}`,folderId:folder.id,subject:`E-Mail ${index}`,sender:folder.path.split("/")[0],recipient:"Julius",cc:"",date:"2026-10-14T10:00:00Z",body:"Lokale Kopie",html:"",attachments:[],large:false }));
    let removed: any[] = [];
    w.__EMAIL_MANAGEMENT_CALLS__ = [];
    const matches = (folder:any,target:any) => folder.source===target.source && folder.sourceId===target.sourceId && (folder.path===target.path || folder.path.startsWith(target.path+"/"));
    const visible = () => folders.filter(folder => !removed.some(target => matches(folder,target)));
    w.__TAURI_INTERNALS__.invoke = (command:string,args:any) => {
      if (command.includes("email_archive")) w.__EMAIL_MANAGEMENT_CALLS__.push({ command,args });
      if (command === "scan_local_email_sources") return Promise.resolve({ sources:[],issues:[] });
      if (command === "get_local_email_copy_status") return Promise.resolve(null);
      if (command === "list_email_archive_folders") return Promise.resolve(visible());
      if (command === "count_email_archive_removals") return Promise.resolve(removed.length);
      if (command === "get_email_archive_folder_preferences") return Promise.resolve(JSON.parse(localStorage.getItem("test.email.order") ?? "{}"));
      if (command === "set_email_archive_folder_preferences") {
        if (w.__FAIL_FOLDER_ORDER__) { w.__FAIL_FOLDER_ORDER__ = false; return Promise.reject("fixture save failed"); }
        const prefs = JSON.parse(localStorage.getItem("test.email.order") ?? "{}");
        if (args.keys) prefs[args.scope]=args.keys; else delete prefs[args.scope];
        localStorage.setItem("test.email.order",JSON.stringify(prefs)); return Promise.resolve(null);
      }
      if (command === "list_email_archive_messages") {
        const q = args.query, ids = visible().map(f => f.id);
        const items = messages.filter(m => ids.includes(m.folderId) && (!q.folderId || q.folderId===m.folderId));
        return Promise.resolve({ items,total:items.length });
      }
      if (command === "read_email_archive_message") return Promise.resolve(messages.find(m => m.id===args.id));
      if (command === "list_email_archive_attachments") return Promise.resolve([]);
      if (command === "preview_email_archive_removal") {
        const selected = visible().filter(folder => matches(folder,args.target));
        return Promise.resolve({ target:args.target,name:args.target.path.split("/").at(-1),folders:selected.length,messages:selected.reduce((n,f) => n+f.count,0),token:"fixture" });
      }
      if (command === "remove_email_archive_folder") { removed.push(args.preview.target); return Promise.resolve(null); }
      if (command === "restore_email_archive_folders") { removed=[]; return Promise.resolve(null); }
      return original(command,args);
    };
  });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name:"Hauptmenü" });
  await nav.getByRole("button", { name:"emails speichern",exact:true }).click();
  await page.getByRole("heading", { name:"emails speichern",exact:true }).hover();
  const rail = page.locator(".email-app-shell > .sidebar");
  await expect.poll(async () => Math.round((await rail.boundingBox())!.width)).toBe(72);
  const contentX = (await page.locator(".email-save-page").boundingBox())!.x;
  await nav.getByRole("button", { name:"Kontakte",exact:true }).hover();
  await expect.poll(async () => Math.round((await rail.boundingBox())!.width)).toBe(250);
  expect((await page.locator(".email-save-page").boundingBox())!.x).toBe(contentX);
  await page.screenshot({ path:testInfo.outputPath("emails-sidebar-expanded.png") });
  await page.getByRole("heading", { name:"emails speichern",exact:true }).hover();
  await expect.poll(async () => Math.round((await rail.boundingBox())!.width)).toBe(72);
  const tree = page.getByRole("tree", { name:"Archivordnerstruktur" });
  const account = tree.getByRole("treeitem", { name:"julius@example.test 3",exact:true });
  await account.click({ button:"right" });
  const menu = page.getByRole("menu", { name:"Aktionen für julius@example.test" });
  await expect(menu.getByRole("menuitem", { name:"Unterordner aufklappen" })).toBeVisible();
  await page.screenshot({ path:testInfo.outputPath("emails-postfach-menu.png") });
  await menu.getByRole("menuitem", { name:"Eigenschaften",exact:true }).click();
  const properties = page.getByRole("dialog", { name:"Eigenschaften",exact:true });
  await expect(properties).toContainText("julius@example.test");
  await properties.getByRole("button", { name:"Schließen" }).click();
  await account.focus(); await page.keyboard.press("Shift+F10");
  await menu.getByRole("menuitem", { name:"Postfach aus Archiv entfernen …" }).click();
  const confirmation = page.getByRole("dialog", { name:"Aus Archiv entfernen?",exact:true });
  await expect(confirmation).toContainText("3 Ordner · 3 Nachrichten");
  await expect(confirmation).toContainText("Ihre Original-E-Mails");
  await confirmation.getByRole("button", { name:"Abbrechen" }).click();
  expect(await page.evaluate(() => (window as any).__EMAIL_MANAGEMENT_CALLS__.filter((c:any) => c.command === "remove_email_archive_folder").length)).toBe(0);
  const directFolders = () => tree.locator('[data-level="2"]').allTextContents();
  expect(await directFolders()).toEqual(["Posteingang1","Archiv1","Posteingang1"]);
  const archive = tree.getByRole("treeitem", { name:"Archiv 1",exact:true });
  await archive.click({ button:"right" });
  await page.getByRole("menuitem", { name:"Nach oben",exact:true }).click();
  await expect.poll(directFolders).toEqual(["Archiv1","Posteingang1","Posteingang1"]);
  await page.reload();
  await page.getByRole("navigation", { name:"Hauptmenü" }).getByRole("button", { name:"emails speichern",exact:true }).click();
  await expect.poll(directFolders).toEqual(["Archiv1","Posteingang1","Posteingang1"]);
  const inbox = tree.getByRole("treeitem", { name:"Posteingang 1",exact:true }).first();
  await inbox.focus(); await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(directFolders).toEqual(["Posteingang1","Archiv1","Posteingang1"]);
  await page.evaluate(() => { (window as any).__FAIL_FOLDER_ORDER__ = true; });
  await archive.click({ button:"right" }); await page.getByRole("menuitem", { name:"Nach oben",exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("Die Ordnerreihenfolge konnte nicht gespeichert werden");
  expect(await directFolders()).toEqual(["Posteingang1","Archiv1","Posteingang1"]);
  // Pointer drag works inside the Windows WebView without using native file drop.
  const archiveBox = (await archive.boundingBox())!, inboxBox = (await inbox.boundingBox())!;
  await page.mouse.move(archiveBox.x + archiveBox.width / 2, archiveBox.y + archiveBox.height / 2);
  await page.mouse.down(); await page.mouse.move(inboxBox.x + inboxBox.width / 2,inboxBox.y + 5,{ steps:8 });
  await expect(inbox).toHaveClass(/drop-before/); await page.mouse.up();
  await expect.poll(directFolders).toEqual(["Archiv1","Posteingang1","Posteingang1"]);
  await archive.click({ button:"right" });
  await expect(page.getByRole("menuitem", { name:"Nach oben",exact:true })).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path:testInfo.outputPath("email-folder-order-menu.png") });
  await page.getByRole("menuitem", { name:"Importierte Reihenfolge wiederherstellen",exact:true }).click();
  await expect.poll(directFolders).toEqual(["Posteingang1","Archiv1","Posteingang1"]);
  await account.click({ button:"right" });
  await menu.getByRole("menuitem", { name:"Postfach aus Archiv entfernen …" }).click();
  await confirmation.getByRole("button", { name:"Aus Archiv entfernen",exact:true }).click();
  await expect(account).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name:"info@example.test 1",exact:true })).toBeVisible();
  const list = page.getByRole("listbox", { name:"Archivierte Nachrichten" });
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.getByRole("button", { name:"Entfernte Postfächer/Ordner wiederherstellen (1)",exact:true }).click();
  await expect(account).toBeVisible(); await expect(list.getByRole("option")).toHaveCount(4);
  await tree.getByRole("treeitem", { name:"Posteingang 1",exact:true }).first().click({ button:"right" });
  await page.getByRole("menuitem", { name:"In diesem Ordner suchen",exact:true }).click();
  await expect(page.getByRole("searchbox", { name:"Archivierte E-Mails suchen" })).toBeFocused();
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.setViewportSize({ width:800,height:900 });
  await expect.poll(async () => Math.round((await rail.boundingBox())!.width)).toBe(72);
  expect(await page.locator(".email-save-page").evaluate(element => element.scrollWidth<=element.clientWidth+1)).toBe(true);
  await page.screenshot({ path:testInfo.outputPath("emails-sidebar-small.png") });
  await nav.getByRole("button", { name:"Kontakte",exact:true }).click();
  await expect(page.locator(".app-shell")).not.toHaveClass(/email-app-shell/);
  const removals = await page.evaluate(() => (window as any).__EMAIL_MANAGEMENT_CALLS__.filter((c:any) => c.command === "remove_email_archive_folder"));
  expect(removals).toHaveLength(1);
  expect(removals[0].args.preview.target).toEqual({ source:"outlook",sourceId:"a",path:"julius@example.test" });
});

test("menu dos emails move categoriza apaga restaura e abre leitor independente", async ({ page },testInfo) => {
  await installTauriMock(page,[]);
  await page.addInitScript(() => {
    const w=window as any, original=w.__TAURI_INTERNALS__.invoke;
    localStorage.setItem("dmh-email-archive-tab","read");
    const base={ sender:"Anna",recipient:"Julius",cc:"",date:"2026-10-14T10:00:00Z",attachments:[],large:false,category:"",categoryColor:"#0078d4",deleted:false };
    const messages=[{ ...base,id:"one",folderId:"inbox",subject:"Teste de backup",body:"",html:'<p>Conteúdo offline seguro</p><img src="https://tracker.example/mail"><script>window.emailExecuted=true</script>' },{ ...base,id:"two",folderId:"inbox",subject:"Outro e-mail",body:"Outra mensagem",html:"" }];
    const current=()=>messages.map(m=>({ ...m,...JSON.parse(localStorage.getItem("test.email.edits") ?? "{}")[m.id] }));
    w.__EMAIL_MESSAGE_CALLS__=[];
    w.__TAURI_INTERNALS__.invoke=(command:string,args:any)=> {
      w.__EMAIL_MESSAGE_CALLS__.push({ command,args });
      if (command==="scan_local_email_sources") return Promise.resolve({ sources:[],issues:[] });
      if (command==="get_local_email_copy_status") return Promise.resolve(null);
      if (command==="get_email_archive_folder_preferences") return Promise.resolve({});
      if (command==="count_email_archive_removals") return Promise.resolve(0);
      if (command==="list_email_archive_folders") return Promise.resolve(["inbox","archive"].map(id=>({ id,name:id==="inbox" ? "Posteingang" : "Archiv",path:`Account/${id==="inbox" ? "Posteingang" : "Archiv"}`,source:"outlook",sourceId:"a",count:current().filter(m=>m.folderId===id && !m.deleted).length })));
      if (command==="list_email_archive_categories") return Promise.resolve(current().filter(m=>m.category).map(m=>({ name:m.category,color:m.categoryColor })));
      if (command==="list_email_archive_messages") {
        const q=args.query,items=current().filter(m=>(!!m.deleted===!!q.includeDeleted) && (!q.folderId || q.folderId===m.folderId) && (!q.category || m.category===q.category));
        return Promise.resolve({ items,total:items.length });
      }
      if (command==="read_email_archive_message") return Promise.resolve(current().find(m=>m.id===args.id));
      if (command==="list_email_archive_attachments") return Promise.resolve([]);
      if (command==="open_email_archive_window") return Promise.resolve(null);
      if (command==="update_email_archive_message") {
        const edit=args.edit,states=JSON.parse(localStorage.getItem("test.email.edits") ?? "{}"); const state=states[edit.id] ?? {};
        if (edit.action==="move") state.folderId=edit.folderId;
        if (edit.action==="category") { state.category=edit.category; state.categoryColor=edit.color; }
        if (edit.action==="trash" || edit.action==="restore") state.deleted=edit.action==="trash";
        states[edit.id]=state; localStorage.setItem("test.email.edits",JSON.stringify(states)); return Promise.resolve(null);
      }
      return original(command,args);
    };
  });
  await page.goto("/");
  const openEmails=()=>page.getByRole("navigation",{ name:"Hauptmenü" }).getByRole("button",{ name:"emails speichern",exact:true }).click();
  await openEmails();
  const list=page.getByRole("listbox",{ name:"Archivierte Nachrichten" }),row=list.getByRole("option",{ name:/Teste de backup/ }),menu=page.getByRole("menu",{ name:"Aktionen für E-Mail" });
  await expect(list.getByRole("option")).toHaveCount(2);
  await row.click({ button:"right" }); await expect(menu).toBeVisible();
  await page.screenshot({ path:testInfo.outputPath("email-message-menu.png") });
  await menu.getByRole("menuitem",{ name:"In separatem Fenster öffnen",exact:true }).click();
  expect(await page.evaluate(()=>(window as any).__EMAIL_MESSAGE_CALLS__.filter((c:any)=>c.command==="open_email_archive_window"))).toEqual([{ command:"open_email_archive_window",args:{ id:"one" } }]);
  await row.click({ button:"right" }); await menu.getByRole("menuitem",{ name:"Kategorisieren …",exact:true }).click();
  const category=page.getByRole("dialog",{ name:"E-Mail kategorisieren",exact:true });
  await category.getByRole("combobox",{ name:"E-Mail-Kategorie" }).fill("Arbeit");
  await category.getByRole("radio",{ name:"Grün",exact:true }).check();
  await category.getByRole("button",{ name:"Speichern",exact:true }).click();
  await expect(row).toContainText("Arbeit");
  await page.getByRole("combobox",{ name:"E-Mails nach Kategorie filtern",exact:true }).selectOption("Arbeit");
  await expect(list.getByRole("option")).toHaveCount(1);
  await row.click({ button:"right" }); await menu.getByRole("menuitem",{ name:"In anderen Archivordner verschieben …",exact:true }).click();
  const move=page.getByRole("dialog",{ name:"E-Mail verschieben",exact:true });
  await move.getByRole("treeitem",{ name:"Archiv",exact:true }).click();
  await page.screenshot({ path:testInfo.outputPath("email-message-move.png") });
  await move.getByRole("button",{ name:"Speichern",exact:true }).click();
  await page.getByRole("tree",{ name:"Archivordnerstruktur" }).getByRole("treeitem",{ name:"Posteingang 1",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(0);
  await page.getByRole("button",{ name:"Zurücksetzen",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(1);
  await page.getByRole("tree",{ name:"Archivordnerstruktur" }).getByRole("treeitem",{ name:"Archiv 1",exact:true }).click();
  await row.click({ button:"right" }); await menu.getByRole("menuitem",{ name:"Aus Backup löschen …",exact:true }).click();
  const deletion=page.getByRole("dialog",{ name:"E-Mail aus Backup löschen?",exact:true });
  await expect(deletion).toContainText("Teste de backup"); await expect(deletion).toContainText("Original-E-Mail");
  await deletion.getByRole("button",{ name:"Abbrechen",exact:true }).click();
  expect(await page.evaluate(()=>(window as any).__EMAIL_MESSAGE_CALLS__.filter((c:any)=>c.command==="update_email_archive_message" && c.args.edit.action==="trash").length)).toBe(0);
  await row.click({ button:"right" }); await menu.getByRole("menuitem",{ name:"Aus Backup löschen …",exact:true }).click();
  await deletion.getByRole("button",{ name:"In Archiv-Papierkorb verschieben",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(0);
  await page.getByRole("combobox",{ name:"Archivansicht",exact:true }).selectOption("trash");
  await expect(list.getByRole("option")).toHaveCount(1);
  await row.focus(); await page.keyboard.press("Shift+F10");
  await menu.getByRole("menuitem",{ name:"Aus Archiv-Papierkorb wiederherstellen",exact:true }).click();
  await expect(list.getByRole("option")).toHaveCount(0);
  await page.getByRole("combobox",{ name:"Archivansicht",exact:true }).selectOption("archive");
  await expect(list.getByRole("option")).toHaveCount(2);
  await page.reload(); await openEmails();
  await row.click(); await expect(page.getByRole("article",{ name:"E-Mail lesen" })).toContainText("Arbeit");
  await page.goto("/?emailArchiveMessage=one");
  await expect(page.getByRole("navigation",{ name:"Hauptmenü" })).toHaveCount(0);
  const standalone=page.getByRole("article",{ name:"E-Mail lesen" });
  await expect(standalone).toContainText("Conteúdo offline seguro"); await expect(standalone).toContainText("Arbeit");
  await expect(standalone.locator("img,iframe,script")).toHaveCount(0);
  const calls=await page.evaluate(()=>(window as any).__EMAIL_MESSAGE_CALLS__.map((c:any)=>c.command));
  expect(calls).not.toContain("get_local_email_copy_status"); expect(calls).not.toContain("scan_local_email_sources"); expect(calls.some((c:string)=>c.includes("m365"))).toBe(false);
  await page.setViewportSize({ width:900,height:720 }); await page.screenshot({ path:testInfo.outputPath("email-message-separate-reader.png") });
});

test("contatos sem grupos ficam ocultos por padrão e o menu lembra a escolha sem alterar contatos", async ({ page }, testInfo) => {
  const group = { id: 9, name: "Equipe", description: "", createdAt: "", updatedAt: "" };
  const grouped = { ...mockContact(2, "Bernd", "Equipe"), groups: [group] };
  await installTauriMock(page, [mockContact(1, "Anna", "SemGrupo"), grouped]);
  await page.addInitScript(({ group }) => {
    const w = window as any;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__DMH_VISIBILITY_DATA_MUTATIONS__ = [];
    w.__TAURI_INTERNALS__.invoke = (command: string, args: any) => {
      if (["save_contact", "delete_contact", "delete_contacts", "delete_all_contacts", "delete_group", "clear_contact_groups", "move_contact_to_group"].includes(command)) w.__DMH_VISIBILITY_DATA_MUTATIONS__.push(command);
      if (command === "list_groups") return Promise.resolve([group]);
      if (command === "get_contact_overview_counts") return Promise.resolve({ total: 2, ungrouped: 1, groups: { 9: 1 } });
      if (command === "get_app_setting" && args.key.startsWith("collected_addresses_")) return Promise.resolve(localStorage.getItem(`test.setting.${args.key}`));
      if (command === "set_app_setting" && args.key.startsWith("collected_addresses_")) {
        localStorage.setItem(`test.setting.${args.key}`, args.value);
        return Promise.resolve(null);
      }
      return invoke(command, args);
    };
  }, { group });
  const openContacts = async () => {
    await page.getByRole("button", { name: "Kontakte", exact: true }).click();
    await expect(page.getByRole("tree", { name: "Kontaktgruppen" })).toBeVisible();
  };
  const toggle = (action: string) => page.getByRole("menuitemcheckbox", { name: `Kontakte ohne Gruppen ${action}`, exact: true });
  const folder = page.locator('.group-list [data-group-key="ungrouped"]');
  const contacts = page.getByRole("listbox", { name: "Kontakte", exact: true });
  await page.goto("/");
  await openContacts();
  await expect(folder).toHaveCount(0);
  await page.getByRole("button", { name: "Weitere Optionen", exact: true }).click();
  await expect(toggle("einblenden")).toHaveAttribute("aria-checked", "false");
  await toggle("einblenden").click();
  await expect(folder).toContainText("Kontakte ohne Gruppen");
  await expect(folder.locator(".group-folder-count")).toHaveText("1");
  await folder.click();
  await expect(contacts.getByRole("option")).toHaveCount(1);
  await expect(contacts).toContainText("Anna SemGrupo");
  await expect(contacts).not.toContainText("Bernd Equipe");
  await page.getByRole("button", { name: "Weitere Optionen", exact: true }).click();
  await expect(toggle("ausblenden")).toHaveAttribute("aria-checked", "true");
  await toggle("ausblenden").click();
  await expect(folder).toHaveCount(0);
  await expect(page.getByRole("treeitem", { name: /Alle Kontakte/ })).toHaveAttribute("aria-selected", "true");
  await expect(contacts.getByRole("option")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__DMH_VISIBILITY_DATA_MUTATIONS__)).toEqual([]);
  await page.reload();
  await openContacts();
  await expect(folder).toHaveCount(0);
  await page.getByRole("button", { name: "Weitere Optionen", exact: true }).click();
  await toggle("einblenden").click();
  await expect(folder).toBeVisible();
  await page.reload();
  await openContacts();
  await expect(folder).toBeVisible();
  await page.getByRole("button", { name: "Weitere Optionen", exact: true }).click();
  await expect(toggle("ausblenden")).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: testInfo.outputPath("kontakten-ohne-gruppen-menu.png") });
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
