import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlookOfficeAccountDialog } from "./OutlookOfficeAccountDialog";
import { defaultSyncConfig } from "../types/sync";

const db = vi.hoisted(() => ({ connectMicrosoft365Interactively: vi.fn(), getAppSetting: vi.fn(), setAppSetting: vi.fn() }));
vi.mock("../services/db", () => db);
const anna = "anna@example.test";
const admin = "admin@tenant.onmicrosoft.com";
const account = { id: "anna", displayName: "Anna", email: anna, userPrincipalName: anna, connectedAt: "" };
const check = { dmhEmail: admin, dmhEmails: [admin], suggestedEmail: anna, accounts: [{ email: anna, displayName: "Anna" }], readSucceeded: true };
beforeEach(() => {
  vi.resetAllMocks();
  db.getAppSetting.mockResolvedValue(JSON.stringify(defaultSyncConfig));
  db.setAppSetting.mockResolvedValue(undefined);
  db.connectMicrosoft365Interactively.mockResolvedValue(account);
});
afterEach(cleanup);

describe("Excel account confirmation", () => {
  it("blocks mismatched DMH/Office identities and signs in only to the confirmed Excel account", async () => {
    const next = vi.fn(); const changed = vi.fn(); const close = vi.fn();
    render(<OutlookOfficeAccountDialog check={check} onContinue={next} onAccountChanged={changed} onClose={close} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Die Konten unterscheiden sich");
    expect(screen.queryByRole("button", { name: "Exchange einrichten" })).toBeNull();
    const login = screen.getByRole("button", { name: "DMH mit Excel-Konto verbinden" });
    expect(login).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Ich habe in Excel/ }));
    await userEvent.click(login);
    await waitFor(() => expect(changed).toHaveBeenCalledWith(account));
    expect(db.connectMicrosoft365Interactively).toHaveBeenCalledWith(anna);
    expect(JSON.parse(db.setAppSetting.mock.calls[0][1]).paused).toBe(true);
    expect(db.setAppSetting.mock.invocationCallOrder[0]).toBeLessThan(db.connectMicrosoft365Interactively.mock.invocationCallOrder[0]);
    expect(next).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires explicit Excel confirmation even for a matching Office identity", async () => {
    const next = vi.fn();
    render(<OutlookOfficeAccountDialog check={{ ...check, dmhEmail: anna, dmhEmails: [anna] }} onContinue={next} onClose={vi.fn()} />);
    expect(screen.getByText(/Gespeicherte Konten bestätigen nicht/)).toBeVisible();
    const start = screen.getByRole("button", { name: "Exchange einrichten" });
    expect(start).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(start);
    expect(next).toHaveBeenCalledWith(anna);
    expect(db.connectMicrosoft365Interactively).not.toHaveBeenCalled();
  });

  it("allows a manually verified Excel email when Office detection is unavailable", async () => {
    const next = vi.fn();
    render(<OutlookOfficeAccountDialog check={{ dmhEmail: anna, dmhEmails: [anna], accounts: [], suggestedEmail: "", readSucceeded: false }} onContinue={next} onClose={vi.fn()} />);
    expect(screen.getByText(/nicht automatisch ermittelt/)).toBeVisible();
    await userEvent.type(screen.getByRole("textbox", { name: "Excel-E-Mail-Adresse" }), anna);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Exchange einrichten" }));
    expect(next).toHaveBeenCalledWith(anna);
  });

  it("resets confirmation when another cached Office account is selected", async () => {
    render(<OutlookOfficeAccountDialog check={{ ...check, accounts: [...check.accounts, { email: admin, displayName: "Admin" }] }} onContinue={vi.fn()} onAccountChanged={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.selectOptions(screen.getByLabelText("Im Office gespeicherte Konten"), admin);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Exchange einrichten" })).toBeDisabled();
  });

  it("does not continue if Microsoft returns a different account", async () => {
    db.connectMicrosoft365Interactively.mockResolvedValue({ ...account, email: admin, userPrincipalName: admin });
    const next = vi.fn(); const changed = vi.fn();
    render(<OutlookOfficeAccountDialog check={check} onContinue={next} onAccountChanged={changed} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "DMH mit Excel-Konto verbinden" }));
    expect(await screen.findByText(/Das bestätigte Excel-Konto wurde nicht verbunden/)).toBeVisible();
    expect(next).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });

  it("cancels without signing in, changing sync preferences or starting a migration", () => {
    const close = vi.fn(); const next = vi.fn();
    render(<OutlookOfficeAccountDialog check={check} onContinue={next} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(close).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled();
    expect(db.connectMicrosoft365Interactively).not.toHaveBeenCalled();
    expect(db.setAppSetting).not.toHaveBeenCalled();
  });
});
