import { expect, test, type Page } from "@playwright/test";

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

async function installTauriMock(page: Page, contacts: MockContact[], options: { loadDelayMs?: number; calendarEvents?: Array<{ id: string; title: string; startsAt: string; endsAt: string; location: string; description: string; color: string; category: string; source: string }> } = {}) {
  await page.addInitScript(({ seedContacts, seedCalendarEvents, loadDelayMs }) => {
    let callbackId = 0;
    const callbacks = new Map<number, (...args: unknown[]) => void>();
    const invoke = async (command: string) => {
      if (loadDelayMs > 0 && ["list_contacts", "list_groups", "get_contact_overview_counts", "get_calendar_overview", "list_calendar_events_in_range", "list_calendar_events"].includes(command)) {
        await new Promise((resolve) => window.setTimeout(resolve, loadDelayMs));
      }
      switch (command) {
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
  }, { seedContacts: contacts, seedCalendarEvents: options.calendarEvents ?? [], loadDelayMs: options.loadDelayMs ?? 0 });
}

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
  const fontSizes = await editor.locator('.calendar-meeting-field input:not([type="checkbox"]), textarea').evaluateAll((fields) => fields.map((field) => getComputedStyle(field).fontSize));
  expect([...new Set(fontSizes)]).toEqual(["16px"]);
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
