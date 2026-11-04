import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlookExchangeSetupStatus } from "../types/outlookExchange";
import { OutlookExchangeProfileSetup } from "./OutlookExchangeProfileSetup";

const db = vi.hoisted(() => ({
  prepareOutlookExchangeProfile: vi.fn(),
  getOutlookExchangeSetupStatus: vi.fn(),
  completeOutlookExchangeProfile: vi.fn()
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

async function clickButton(name: string | RegExp) {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  db.prepareOutlookExchangeProfile.mockResolvedValue(waiting);
  db.getOutlookExchangeSetupStatus.mockResolvedValue(waiting);
  db.completeOutlookExchangeProfile.mockResolvedValue(completed);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Outlook Exchange profile setup", () => {
  it("starts no Outlook work until the user clicks and respects disabled state", () => {
    render(<OutlookExchangeProfileSetup email={email} disabled />);
    expect(screen.getByRole("button", { name: "Zu Exchange wechseln" })).toBeDisabled();
    expect(db.prepareOutlookExchangeProfile).not.toHaveBeenCalled();
    expect(db.getOutlookExchangeSetupStatus).not.toHaveBeenCalled();
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
  });

  it("asks to close Outlook and retries without claiming a completed switch", async () => {
    db.prepareOutlookExchangeProfile.mockResolvedValueOnce({ ...waiting, stage: "outlook_open", message: "Outlook ist noch geöffnet." });
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    expect(screen.getByText(/Bitte offene Nachrichten speichern/)).toBeVisible();
    expect(db.completeOutlookExchangeProfile).not.toHaveBeenCalled();
    await clickButton("Erneut versuchen");
    expect(db.prepareOutlookExchangeProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Falls Microsoft danach fragt/)).toBeVisible();
  });

  it("keeps prepared profiles pending and activates only after Exchange is confirmed", async () => {
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    expect(db.prepareOutlookExchangeProfile).toHaveBeenCalledWith();
    expect(screen.queryByText(completed.message)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText(completed.message)).toBeNull();
    await clickButton("Exchange-Verbindung prüfen");
    expect(screen.getByText(completed.message)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops polling after four minutes and offers a manual continuation", async () => {
    render(<OutlookExchangeProfileSetup email={email} />);
    await clickButton("Zu Exchange wechseln");
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
    expect(screen.getByText(/nach vier Minuten angehalten/)).toBeVisible();
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
    expect(db.getOutlookExchangeSetupStatus).toHaveBeenCalledTimes(1);
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
