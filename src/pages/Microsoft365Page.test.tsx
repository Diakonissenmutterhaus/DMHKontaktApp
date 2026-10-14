import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";
import { Microsoft365Page } from "./Microsoft365Page";
import { enableCompleteAutomaticMicrosoft365Sync } from "../utils/microsoft365SyncConfig";

const db = vi.hoisted(() => ({
  getMicrosoft365ConnectionStatus: vi.fn(), getAppSetting: vi.fn(),
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
  db.connectMicrosoft365WithWindowsAccount.mockResolvedValue(account);
  db.connectMicrosoft365Interactively.mockResolvedValue(account);
  db.testMicrosoft365Connection.mockResolvedValue({ configured: true, connected: true, account });
});
afterEach(cleanup);

describe("Microsoft365Page Windows account login", () => {
  it("connects only after a click through the native Windows-first flow", async () => {
    render(<Microsoft365Page title="M365 Anmeldung" />);
    const button = await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" });
    expect(db.connectMicrosoft365WithWindowsAccount).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(db.connectMicrosoft365WithWindowsAccount).toHaveBeenCalledTimes(1);
    expect(db.connectMicrosoft365Interactively).not.toHaveBeenCalled();
    expect(db.startMicrosoft365Connection).not.toHaveBeenCalled();
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
    render(<Microsoft365Page />);
    await userEvent.click(await screen.findByRole("button", { name: "Mit Microsoft 365 verbinden" }));
    expect(await screen.findByText("Anna Test")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Automatik einschalten");
    await userEvent.click(screen.getByRole("button", { name: "Automatik einschalten" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(db.connectMicrosoft365WithWindowsAccount).toHaveBeenCalledTimes(1);
  });
});
