import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlookProfileManager } from "./OutlookProfileManager";

const db = vi.hoisted(() => ({ getOutlookProfileCatalog: vi.fn(), setOutlookDefaultProfile: vi.fn(), openOutlookProfile: vi.fn(), createOutlookProfile: vi.fn(), removeOutlookProfile: vi.fn() }));
vi.mock("../services/db", () => db);
const catalog = {
  defaultProfile: "Profile Exchange 2", activeProfile: "Outlook", promptForProfile: false,
  profiles: [
    { name: "Outlook", source: "active", accounts: [{ email: "anna@example.test", user: "anna", name: "Anna", accountType: "IMAP", server: "imap.example.test" }], stores: [{ name: "Archiv", kind: "PST", path: "C:\\Archiv\\team.pst", inbox: "\\\\Archiv\\Posteingang" }], note: "Im geöffneten Outlook bestätigt." },
    { name: "Profile Exchange 2", source: "registered", accounts: [{ email: "anna@example.test", user: "anna@example.test", name: "Anna", accountType: "Exchange", server: "" }], stores: [], note: "Gespeicherte Konfiguration. Zugriff erst im geöffneten Profil prüfbar." }
  ]
};
beforeEach(() => {
  vi.resetAllMocks();
  db.getOutlookProfileCatalog.mockResolvedValue(catalog);
  db.setOutlookDefaultProfile.mockResolvedValue({ defaultProfile: "Outlook" });
  db.openOutlookProfile.mockResolvedValue({ message: "Outlook wurde mit dem gewählten Profil geöffnet." });
});
afterEach(cleanup);

describe("Outlook profile manager", () => {
  it("creates a named profile only after submitting the form without changing the default", async () => {
    db.createOutlookProfile.mockResolvedValue({ profile: "Arbeit" });
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hinzufügen…" }));
    expect(db.createOutlookProfile).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Neues Profil"), "Arbeit");
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, profiles: [...catalog.profiles, { name: "Arbeit", source: "registered", accounts: [], stores: [], note: "" }] });
    await userEvent.click(screen.getByRole("button", { name: "Profil erstellen" }));
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: "Arbeit" });
    expect(screen.getByLabelText("Eingerichtete Profile")).toHaveValue("Arbeit");
    expect(db.createOutlookProfile).toHaveBeenCalledWith("Arbeit");
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("requires a replacement and explicit confirmation before removing the default", async () => {
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, activeProfile: "" });
    db.removeOutlookProfile.mockResolvedValue({ defaultProfile: "Outlook" });
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "Entfernen" }));
    expect(db.removeOutlookProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Profil endgültig entfernen" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Neues Standardprofil"), "Outlook");
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, defaultProfile: "Outlook", activeProfile: "", profiles: [catalog.profiles[0]] });
    await userEvent.click(screen.getByRole("button", { name: "Profil endgültig entfernen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("entfernt");
    expect(db.removeOutlookProfile).toHaveBeenCalledWith("Profile Exchange 2", "Outlook");
    expect(changed).toHaveBeenCalledWith("Outlook");
  });

  it("blocks deletion while Outlook is open and allows canceling the confirmation", async () => {
    render(<OutlookProfileManager onDefaultChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Entfernen" }));
    await userEvent.selectOptions(screen.getByLabelText("Neues Standardprofil"), "Outlook");
    expect(screen.getByRole("button", { name: "Profil endgültig entfernen" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("group", { name: "Profilentfernung bestätigen" })).not.toBeInTheDocument();
    expect(db.removeOutlookProfile).not.toHaveBeenCalled();
  });

  it("removes a non-default profile without replacing the default", async () => {
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, activeProfile: "" });
    db.removeOutlookProfile.mockResolvedValue({ defaultProfile: catalog.defaultProfile });
    render(<OutlookProfileManager onDefaultChanged={vi.fn()} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet|^Outlook$/ });
    await userEvent.selectOptions(screen.getByLabelText("Eingerichtete Profile"), "Outlook");
    await userEvent.click(screen.getByRole("button", { name: "Entfernen" }));
    expect(screen.queryByLabelText("Neues Standardprofil")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Profil endgültig entfernen" }));
    expect(db.removeOutlookProfile).toHaveBeenCalledWith("Outlook", null);
  });

  it("can remove the last profile and leaves no default", async () => {
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, defaultProfile: "Outlook", activeProfile: "", profiles: [catalog.profiles[0]] });
    db.removeOutlookProfile.mockResolvedValue({ defaultProfile: "" });
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await userEvent.click(await screen.findByRole("button", { name: "Entfernen" }));
    expect(screen.getByText(/Danach ist kein Outlook-Profil/)).toBeVisible();
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, defaultProfile: "", activeProfile: "", profiles: [] });
    await userEvent.click(screen.getByRole("button", { name: "Profil endgültig entfernen" }));
    expect(await screen.findByText("Keine eingerichteten Profile gefunden.")).toBeVisible();
    expect(db.removeOutlookProfile).toHaveBeenCalledWith("Outlook", null);
    expect(changed).toHaveBeenCalledWith("");
  });

  it("keeps the profile and permits a retry after a native removal error", async () => {
    db.getOutlookProfileCatalog.mockResolvedValue({ ...catalog, activeProfile: "" });
    db.removeOutlookProfile.mockRejectedValue("Outlook wurde inzwischen geöffnet");
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet|^Outlook$/ });
    await userEvent.selectOptions(screen.getByLabelText("Eingerichtete Profile"), "Outlook");
    await userEvent.click(screen.getByRole("button", { name: "Entfernen" }));
    await userEvent.click(screen.getByRole("button", { name: "Profil endgültig entfernen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Outlook wurde inzwischen geöffnet");
    expect(screen.getByLabelText("Eingerichtete Profile")).toHaveValue("Outlook");
    expect(screen.getByRole("button", { name: "Profil endgültig entfernen" })).toBeEnabled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("opens the selected non-default profile without saving a new default", async () => {
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet|^Outlook$/ });
    await userEvent.selectOptions(screen.getByLabelText("Eingerichtete Profile"), "Outlook");
    await userEvent.click(screen.getByRole("button", { name: "Öffnen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("gewählten Profil geöffnet");
    expect(db.openOutlookProfile).toHaveBeenCalledWith("Outlook");
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Standardprofil")).toHaveValue("Profile Exchange 2");
  });
  it("previews accounts, inboxes and PST paths and changes the default only on explicit save", async () => {
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet/ });
    expect(screen.queryByRole("table", { name: "Konten des gewählten Profils" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Eigenschaften" }));
    expect(screen.getByLabelText("Eingerichtete Profile")).toHaveValue("Profile Exchange 2");
    const properties = screen.getByRole("dialog", { name: "Eigenschaften von Profile Exchange 2" });
    expect(properties).toHaveAttribute("aria-modal", "true");
    expect(within(properties).getByText("Exchange")).toBeVisible();
    expect(within(properties).getByText(/Gespeicherte Konfiguration/)).toBeVisible();
    expect(screen.getByRole("region", { name: "Outlook-Profile verwalten" })).not.toContainElement(properties);
    await userEvent.click(within(properties).getByRole("button", { name: "Schließen" }));
    await userEvent.selectOptions(screen.getByLabelText("Eingerichtete Profile"), "Outlook");
    await userEvent.click(screen.getByRole("button", { name: "Eigenschaften" }));
    expect(screen.getByText("IMAP")).toBeVisible();
    expect(screen.getByText("imap.example.test")).toBeVisible();
    expect(screen.getByText("anna")).toBeVisible();
    expect(screen.getByText("C:\\Archiv\\team.pst")).toBeVisible();
    expect(screen.getByText("\\\\Archiv\\Posteingang")).toBeVisible();
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Als Standard verwenden" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Standardprofil gespeichert: Outlook");
    expect(db.setOutlookDefaultProfile).toHaveBeenCalledWith("Outlook");
    expect(changed).toHaveBeenCalledWith("Outlook");
    expect(screen.getByRole("button", { name: "Als Standard verwenden" })).toBeDisabled();
  });

  it("opens the selected profile from its properties without changing the default and returns focus when closed", async () => {
    render(<OutlookProfileManager onDefaultChanged={vi.fn()} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet/ });
    const trigger = screen.getByRole("button", { name: "Eigenschaften" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Mit diesem Profil öffnen" }));
    await waitFor(() => expect(db.openOutlookProfile).toHaveBeenCalledWith("Profile Exchange 2"));
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Schließen" })).toBeEnabled());
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps the existing default after a failed save and offers a retry", async () => {
    db.setOutlookDefaultProfile.mockRejectedValueOnce("Profil nicht mehr vorhanden");
    const changed = vi.fn();
    render(<OutlookProfileManager onDefaultChanged={changed} />);
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet|^Outlook$/ });
    await userEvent.selectOptions(screen.getByLabelText("Eingerichtete Profile"), "Outlook");
    await userEvent.selectOptions(screen.getByLabelText("Standardprofil"), "Outlook");
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Profil nicht mehr vorhanden");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Übernehmen" })).toBeEnabled();
    expect(db.setOutlookDefaultProfile).toHaveBeenCalledWith("Outlook");
  });

  it("can refresh after a catalog read failure without changing any profile", async () => {
    db.getOutlookProfileCatalog.mockRejectedValueOnce(new Error("Unavailable"));
    render(<OutlookProfileManager onDefaultChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Aktualisieren" }));
    await within(screen.getByLabelText("Eingerichtete Profile")).findByRole("option", { name: /Outlook · geöffnet/ });
    expect(screen.getByLabelText("Eingerichtete Profile")).toBeEnabled();
    expect(db.setOutlookDefaultProfile).not.toHaveBeenCalled();
  });
});
