import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlookExchangeSetupStatus } from "../types/outlookExchange";
import { OutlookExchangeProfileSetup } from "./OutlookExchangeProfileSetup";

const db = vi.hoisted(() => ({
  prepareOutlookExchangeProfile: vi.fn(),
  getOutlookExchangeSetupStatus: vi.fn(),
  completeOutlookExchangeProfile: vi.fn(),
  getOutlookOfficeAccountCheck: vi.fn()
}));
vi.mock("../services/db", () => db);

const email = "anna@example.test";
const waiting: OutlookExchangeSetupStatus = {
  stage: "awaiting_login",
  email,
  previousProfile: "Outlook",
  exchangeProfile: "Profile Exchange",
  imapProfile: "Profile IMAP",
  message: "Das neue Profil ist vorbereitet. Bitte die Anmeldung in Outlook abschließen."
};
const completed: OutlookExchangeSetupStatus = { ...waiting, stage: "complete", message: "Outlook ist mit Exchange verbunden. Profile Exchange ist das Standardprofil." };
const progressMessage = "Wird eingerichtet. Bitte warten und die Anwendung nicht schließen.";

async function clickButton(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
  if (screen.queryByRole("dialog", { name: "Excel-Konto prüfen" })) {
    await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /Ich habe in Excel/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Exchange einrichten" })); });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  db.prepareOutlookExchangeProfile.mockResolvedValue(waiting);
  db.getOutlookExchangeSetupStatus.mockResolvedValue(waiting);
  db.completeOutlookExchangeProfile.mockResolvedValue(completed);
  db.getOutlookOfficeAccountCheck.mockResolvedValue({ dmhEmail: email, dmhEmails: [email], accounts: [{ email, displayName: "Anna" }], suggestedEmail: email, readSucceeded: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Outlook Exchange profile setup", () => {
  it("blocks profile creation on an Office/DMH mismatch and lets the user cancel without migration", async () => {
    db.getOutlookOfficeAccountCheck.mockResolvedValue({ dmhEmail: email, dmhEmails: [email], accounts: [{ email: "employee@example.test", displayName: "Employee" }], suggestedEmail: "employee@example.test", readSucceeded: true });
    render(<OutlookExchangeProfileSetup email={email} onAccountChanged={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Zu Exchange wechseln" })); });
    expect(screen.getByRole("dialog", { name: "Excel-Konto prüfen" })).toBeVisible();
    expect(screen.getByText(/Die Konten unterscheiden sich/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Exchange einrichten" })).toBeNull();
    expect(db.prepareOutlookExchangeProfile).not.toHaveBeenCalled();
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(db.prepareOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("opens a blocking dialog immediately and keeps it through preparation, polling and finalization", async () => {
    let resolvePrepare!: (value: OutlookExchangeSetupStatus) => void;
    let resolveComplete!: (value: OutlookExchangeSetupStatus) => void;
    db.prepareOutlookExchangeProfile.mockReturnValue(new Promise<OutlookExchangeSetupStatus>((resolve) => { resolvePrepare = resolve; }));
    db.completeOutlookExchangeProfile.mockReturnValue(new Promise<OutlookExchangeSetupStatus>((resolve) => { resolveComplete = resolve; }));
    const view = render(<OutlookExchangeProfileSetup email={email} />);
    view.container.id = "root";
    await clickButton("Zu Exchange wechseln");
    const dialog = screen.getByRole("dialog", { name: progressMessage });
    expect(dialog).toHaveFocus();
    expect(view.container).toHaveAttribute("inert");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeVisible();
    await act(async () => { resolvePrepare(waiting); });
    expect(screen.getByRole("dialog")).toBe(dialog);
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => { resolveComplete(completed); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.container).not.toHaveAttribute("inert");
    expect(screen.getByText(completed.message)).toBeVisible();
  });
  it("waits for Outlook to close before reporting durable activation and keeps polling", async () => {
    const closing: OutlookExchangeSetupStatus = { ...waiting, stage: "awaiting_close", message: "Exchange ist verbunden. Bitte Outlook vollständig schließen." };
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    db.completeOutlookExchangeProfile.mockResolvedValueOnce(closing);
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByText(progressMessage)).toBeVisible();
    expect(screen.queryByText(closing.message)).toBeNull();
    expect(screen.queryByText(completed.message)).toBeNull();
    expect(screen.queryByText(/Bitte die Einrichtung im geöffneten Outlook abschließen/)).toBeNull();
    db.getOutlookExchangeSetupStatus.mockResolvedValue(closing);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(db.completeOutlookExchangeProfile).toHaveBeenCalledTimes(2);
  });
  it("restores a completed compact view without repeating login or activation", async () => {
    db.getOutlookExchangeSetupStatus.mockResolvedValue(completed);
    render(<OutlookExchangeProfileSetup email={email} compact leadingAction={<button>Synchronisieren</button>} />);
    await act(async () => {});
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Outlook auf Exchange umstellen" })).toBeNull();
    expect(screen.queryByText(/Bitte die Einrichtung im geöffneten Outlook/)).toBeNull();
    expect(screen.getByRole("button", { name: "Synchronisieren" })).toBeVisible();
    expect(db.prepareOutlookExchangeProfile).not.toHaveBeenCalled();
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("shows finalization separately from login while the default profile is saved", async () => {
    let resolveComplete!: (value: OutlookExchangeSetupStatus) => void;
    db.completeOutlookExchangeProfile.mockReturnValue(new Promise<OutlookExchangeSetupStatus>((resolve) => { resolveComplete = resolve; }));
    render(<OutlookExchangeProfileSetup email={email} compact />);
    await clickButton("Zu Exchange wechseln");
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByText(progressMessage)).toBeVisible();
    expect(screen.queryByText(/Bitte die Einrichtung im geöffneten Outlook/)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => { resolveComplete(completed); });
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("reads saved status but creates or activates no profiles without a click", () => {
    render(<OutlookExchangeProfileSetup email={email} disabled />);
    expect(screen.getByRole("button", { name: "Zu Exchange wechseln" })).toBeDisabled();
    expect(db.prepareOutlookExchangeProfile).not.toHaveBeenCalled();
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(1);
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("asks to close Outlook and retries without claiming a completed switch", async () => {
    db.prepareOutlookExchangeProfile.mockResolvedValueOnce({ ...waiting, stage: "outlook_open", message: "Outlook ist noch geöffnet." });
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    expect(screen.getByText("Outlook ist noch geöffnet.")).toBeVisible();
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
    await clickButton("Erneut versuchen");
    expect(db.prepareOutlookExchangeProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByText(progressMessage)).toBeVisible();
    expect(screen.queryByText(waiting.message)).toBeNull();
  });

  it("keeps prepared profiles pending and activates only after Exchange is confirmed", async () => {
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    expect(db.prepareOutlookExchangeProfile).toHaveBeenCalledWith(email);
    expect(screen.queryByText(completed.message)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(2);
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(db.completeOutlookExchangeProfile).toHaveBeenCalledWith();
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows activation failures inline and allows another connection check", async () => {
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    db.completeOutlookExchangeProfile.mockRejectedValueOnce("Das Profil konnte nicht als Standard eingerichtet werden. Bitte erneut versuchen.");
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Bitte erneut versuchen");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(completed.message)).toBeNull();
    await clickButton("Einrichtung abschließen");
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops polling after four minutes and offers a manual continuation", async () => {
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
    expect(screen.getByText(/nach vier Minuten angehalten/)).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Exchange-Verbindung prüfen" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Einrichtung fortsetzen" })).toBeEnabled();
    const calls = db.getOutlookExchangeSetupStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(calls);
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("does not activate a late response after the dialog closes", async () => {
    let resolveStatus!: (value: OutlookExchangeSetupStatus) => void;
    db.getOutlookExchangeSetupStatus.mockReturnValue(new Promise<OutlookExchangeSetupStatus>((resolve) => { resolveStatus = resolve; }));
    const view = render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    view.unmount();
    await act(async () => { resolveStatus({ ...waiting, stage: "connected" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(2);
  });

  it("does not activate a status belonging to a different Microsoft account", async () => {
    db.prepareOutlookExchangeProfile.mockResolvedValue({ ...waiting, stage: "connected", email: "other@example.test" });
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    expect(screen.getByRole("alert")).toHaveTextContent("Microsoft-365-Konto wurde geändert");
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("continues checking when connectivity disappears during activation", async () => {
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    db.completeOutlookExchangeProfile.mockResolvedValueOnce(waiting);
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.queryByText(completed.message)).toBeNull();
    expect(db.completeOutlookExchangeProfile).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(db.completeOutlookExchangeProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByText(completed.message)).toBeVisible();
  });

  it("rejects a completion for another account instead of reporting success", async () => {
    db.getOutlookExchangeSetupStatus.mockResolvedValue({ ...waiting, stage: "connected" });
    db.completeOutlookExchangeProfile.mockResolvedValue({ ...completed, email: "other@example.test" });
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Microsoft-365-Konto wurde geändert");
    expect(screen.queryByText(completed.message)).toBeNull();
  });
});
