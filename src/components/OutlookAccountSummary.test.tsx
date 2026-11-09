import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlookAccountSummary } from "./OutlookAccountSummary";

const db = vi.hoisted(() => ({ getOutlookAccountConfiguration: vi.fn(), openOutlookDefaultProfile: vi.fn() }));
vi.mock("../services/db", () => db);
const email = "anna@example.test";
const imap = { email, profile: "Outlook", source: "default", accounts: [{ accountType: "IMAP", server: "imap.example.test" }], message: "Outlook geschlossen · gespeichertes Standardprofil" };
beforeEach(() => {
  vi.resetAllMocks();
  db.getOutlookAccountConfiguration.mockResolvedValue(imap);
  db.openOutlookDefaultProfile.mockResolvedValue({ message: "Outlook wurde mit dem Standardprofil geöffnet." });
});
afterEach(cleanup);

describe("Outlook account configuration", () => {
  it("distinguishes the next startup profile from the current instance and opens only on click", async () => {
    db.getOutlookAccountConfiguration.mockResolvedValue({ ...imap, source: "active", defaultProfile: "Profile Exchange 2", activeProfile: "Outlook" });
    render(<OutlookAccountSummary email={email} />);
    expect(await screen.findByText("Profile Exchange 2")).toBeVisible();
    expect(screen.getByText(/Geöffnet:/)).toHaveTextContent("Outlook");
    expect(screen.getByText(/Standardprofil:/)).toHaveTextContent("Profile Exchange 2");
    expect(db.openOutlookDefaultProfile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Outlook öffnen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Standardprofil geöffnet");
    expect(db.openOutlookDefaultProfile).toHaveBeenCalledTimes(1);
  });
  it("shows the actual saved IMAP server and distinguishes the closed default profile", async () => {
    render(<OutlookAccountSummary email={email} />);
    expect(await screen.findByText("IMAP")).toBeVisible();
    expect(screen.getByText(/imap.example.test/)).toBeVisible();
    expect(screen.getByText(/Standardprofil:/)).toBeVisible();
    expect(screen.queryByText("Outlook geschlossen")).not.toBeInTheDocument();
    expect(screen.queryByText("Exchange")).toBeNull();
  });

  it("replaces the IMAP status with the active Exchange configuration after refresh", async () => {
    render(<OutlookAccountSummary email={email} />);
    await screen.findByText("IMAP");
    db.getOutlookAccountConfiguration.mockResolvedValue({ email, profile: "Profile Exchange", source: "active", accounts: [{ accountType: "Exchange", server: "exchange.example.test" }], message: "" });
    fireEvent.focus(window);
    expect(await screen.findByText("Exchange")).toBeVisible();
    expect(screen.getByText(/exchange.example.test/)).toBeVisible();
    expect(screen.getByText(/Geöffnet:/)).toBeVisible();
    expect(screen.queryByText("IMAP")).toBeNull();
  });

  it("does not infer Exchange from a Microsoft 365 connection when Outlook cannot confirm it", async () => {
    db.getOutlookAccountConfiguration.mockResolvedValue({ email, profile: "Profile Exchange", source: "default", accounts: [], message: "Outlook Classic öffnen, um Kontotyp und Server zu prüfen." });
    render(<OutlookAccountSummary email={email} />);
    expect(await screen.findByText("Profile Exchange")).toBeVisible();
    expect(screen.queryByText("Exchange")).toBeNull();
    expect(screen.queryByText("IMAP")).toBeNull();
  });

  it("rejects configuration belonging to another Microsoft account", async () => {
    db.getOutlookAccountConfiguration.mockResolvedValue({ ...imap, email: "other@example.test" });
    render(<OutlookAccountSummary email={email} />);
    expect(await screen.findByText(/Konfiguration nicht lesbar/)).toBeVisible();
    expect(screen.queryByText(/imap.example.test/)).toBeNull();
  });
});
