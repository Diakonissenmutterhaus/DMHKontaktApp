import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";
import { Microsoft365Page } from "./Microsoft365Page";
import { enableCompleteAutomaticMicrosoft365Sync } from "../utils/microsoft365SyncConfig";

const db = vi.hoisted(() => ({
  getMicrosoft365ConnectionStatus: vi.fn(), getAppSetting: vi.fn(), getOutlookAccountConfiguration: vi.fn(), getOutlookExchangeSetupStatus: vi.fn(),
  connectMicrosoft365WithWindowsAccount: vi.fn(), connectMicrosoft365Interactively: vi.fn(),
  disconnectMicrosoft365Account: vi.fn(), testMicrosoft365Connection: vi.fn(),
  cancelMicrosoft365Connection: vi.fn(), openMicrosoft365SignIn: vi.fn(),
  pollMicrosoft365Connection: vi.fn(), startMicrosoft365Connection: vi.fn()
}));
vi.mock("../services/db", () => db);
vi.mock("../utils/microsoft365SyncConfig", () => ({ enableCompleteAutomaticMicrosoft365Sync: vi.fn(async () => defaultSyncConfig) }));

const account = { id: "account-one", displayName: "Anna Test", email: "anna@example.test", userPrincipalName: "anna@example.test", connectedAt: "2026-10-13T12:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enableCompleteAutomaticMicrosoft365Sync).mockResolvedValue(defaultSyncConfig);
  db.getMicrosoft365ConnectionStatus.mockResolvedValue({ configured: true, connected: false, account: null });
  db.getAppSetting.mockResolvedValue(null);
  db.getOutlookExchangeSetupStatus.mockResolvedValue({ stage: "ready", email: account.email });
  db.getOutlookAccountConfiguration.mockResolvedValue({ email: account.email, profile: "Outlook", source: "default", accounts: [{ accountType: "IMAP", server: "imap.example.test" }], message: "Outlook geschlossen · gespeichertes Standardprofil" });
  db.connectMicrosoft365WithWindowsAccount.mockResolvedValue(account);
  db.connectMicrosoft365Interactively.mockResolvedValue(account);
  db.testMicrosoft365Connection.mockResolvedValue({ configured: true, connected: true, account });
});
afterEach(cleanup);

describe("Microsoft365Page Windows account login", () => {
  it("keeps one loading window from login until sync, overview and both Outlook queries finish", async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => { resolve = done; });
      return { promise, resolve };
    };
    const login = deferred<typeof account>();
    const setup = deferred<typeof defaultSyncConfig>();
    const firstSync = deferred<"success">();
    const overview = deferred<string | null>();
    const outlook = deferred<any>();
    const exchange = deferred<any>();
    db.connectMicrosoft365WithWindowsAccount.mockReturnValue(login.promise);
    vi.mocked(enableCompleteAutomaticMicrosoft365Sync).mockReturnValue(setup.promise);
    db.getOutlookAccountConfiguration.mockReturnValue(outlook.promise);
    db.getOutlookExchangeSetupStatus.mockReturnValue(exchange.promise);
    const synchronize = vi.fn(() => firstSync.promise);
    render(<Microsoft365Page synchronizeAfterConnection={synchronize} />);
    await userEvent.click(await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    const modal = await screen.findByRole("dialog");
    await waitFor(() => expect(db.connectMicrosoft365WithWindowsAccount).toHaveBeenCalled());
    await act(async () => login.resolve(account));
    await act(async () => setup.resolve(defaultSyncConfig));
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBe(modal);
    db.getAppSetting.mockReturnValue(overview.promise);
    await act(async () => firstSync.resolve("success"));
    expect(screen.getByRole("dialog")).toBe(modal);
    await act(async () => overview.resolve(null));
    expect(screen.getByRole("dialog")).toBe(modal);
    await act(async () => exchange.resolve({ stage: "ready", email: account.email }));
    expect(screen.getByRole("dialog")).toBe(modal);
    await act(async () => outlook.resolve({ email: account.email, defaultProfile: "Exchange", source: "default", accounts: [] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Exchange")).toBeVisible();
  });

  it("waits for initial overview reads even when the account status already returned", async () => {
    let finish!: (value: null) => void;
    db.getAppSetting.mockReturnValue(new Promise<null>((resolve) => { finish = resolve; }));
    render(<Microsoft365Page />);
    await waitFor(() => expect(db.getAppSetting).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => finish(null));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ends loading with an actionable error instead of success when the first sync fails", async () => {
    render(<Microsoft365Page synchronizeAfterConnection={async () => "error"} />);
    await userEvent.click(await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Anna Test")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("nicht vollständig geladen");
    expect(screen.queryByText(/Microsoft 365 wurde verbunden\./)).toBeNull();
  });

  it("connects only after a click through the native Windows-first flow", async () => {
    render(<Microsoft365Page title="M365 Anmeldung" />);
    const button = await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" });
    expect(db.connectMicrosoft365WithWindowsAccount).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(db.connectMicrosoft365WithWindowsAccount).toHaveBeenCalledTimes(1);
    expect(db.connectMicrosoft365Interactively).not.toHaveBeenCalled();
    expect(db.startMicrosoft365Connection).not.toHaveBeenCalled();
    const profileButton = screen.getByRole("button", { name: "Zu Exchange wechseln" });
    expect(profileButton).toBeVisible();
    expect(profileButton.closest(".m365-sync-overview")).toContainElement(screen.getByRole("button", { name: /Jetzt alles synchronisieren|Automatik einschalten/ }));
    expect(screen.getByRole("heading", { name: "Automatische Synchronisierung" })).toBeVisible();
  });
  it("allows an explicit choice of another account using the existing browser login", async () => {
    render(<Microsoft365Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Anderes Konto verwenden" }));
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(db.connectMicrosoft365Interactively).toHaveBeenCalledTimes(1);
    expect(db.connectMicrosoft365WithWindowsAccount).not.toHaveBeenCalled();
  });
  it("keeps technical errors out of the UI and allows retry", async () => {
    db.connectMicrosoft365WithWindowsAccount.mockRejectedValueOnce("WAM_provider_error AADSTS50011 private server detail");
    render(<Microsoft365Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bitte erneut verbinden");
    expect(alert).not.toHaveTextContent("AADSTS");
    expect(screen.queryByText(/private server detail/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("checks an existing connection without starting a new interactive login", async () => {
    db.getMicrosoft365ConnectionStatus.mockResolvedValue({ configured: true, connected: true, account });
    render(<Microsoft365Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Verbindung prüfen" }));
    await waitFor(() => expect(db.testMicrosoft365Connection).toHaveBeenCalledTimes(1));
    expect(db.connectMicrosoft365WithWindowsAccount).not.toHaveBeenCalled();
    expect(db.connectMicrosoft365Interactively).not.toHaveBeenCalled();
  });
  it("keeps the account connected and offers a real action if synchronization setup fails", async () => {
    vi.mocked(enableCompleteAutomaticMicrosoft365Sync).mockRejectedValueOnce("HTTP 503 private diagnostic");
    render(<Microsoft365Page title="M365 Anmeldung" />);
    await userEvent.click(await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Automatische Synchronisierung" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Zu Exchange wechseln" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Automatik einschalten");
    await userEvent.click(screen.getByRole("button", { name: "Automatik einschalten" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(db.connectMicrosoft365WithWindowsAccount).toHaveBeenCalledTimes(1);
  });
});
