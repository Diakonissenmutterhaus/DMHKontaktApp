import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "../types/calendar";
import { CalendarEventForm } from "./CalendarEventForm";

const initialEvent: CalendarEvent = {
  id: "draft",
  title: "Fortbildung",
  startsAt: "2026-09-24T09:00:00",
  endsAt: "2026-09-24T10:00:00",
  isAllDay: false,
  location: "",
  description: "",
  color: "blue",
  category: "",
  source: "local"
};

function Harness() {
  const [event, setEvent] = useState(initialEvent);
  return (
    <CalendarEventForm
      value={event}
      isNew
      categories={[{ name: "Fortbildung", color: "green" }]}
      events={[]}
      calendars={[
        { id: "local:DMH Backup", name: "DMH Backup", editable: true },
        { id: "exchange-work", name: "Microsoft 365 · Arbeit", editable: true },
        { id: "exchange-readonly", name: "Microsoft 365 · Team", editable: false }
      ]}
      onChange={setEvent}
      onSave={() => undefined}
      onDelete={() => undefined}
      onCancel={() => undefined}
    />
  );
}

describe("CalendarEventForm", () => {
  it("preserva o Teams ativado em uma reunião existente e permite configurar um novo evento", async () => {
    const onChange = vi.fn();
    const value = { ...initialEvent, id: "m365:calendar:remote", meeting: { requiredAttendees: [], optionalAttendees: [], showAs: "busy" as const, reminderMinutes: 15, isPrivate: false, isOnlineMeeting: true, onlineMeetingUrl: "https://teams.microsoft.com/l/meetup-join/example" } };
    const props = { isNew: false, categories: [], events: [], onChange, onSave: () => undefined, onDelete: () => undefined, onCancel: () => undefined };
    const { rerender } = render(<CalendarEventForm {...props} value={value} />);
    const toggle = screen.getByRole("checkbox", { name: "Teams-Besprechung" });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("link", { name: "Beitreten" })).toHaveAttribute("href", value.meeting.onlineMeetingUrl);
    await userEvent.setup().click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<CalendarEventForm {...props} isNew value={{ ...value, id: "draft", meeting: { ...value.meeting, onlineMeetingUrl: "" } }} />);
    expect(screen.getByRole("checkbox", { name: "Teams-Besprechung" })).toBeEnabled();
  });
  it("permite escolher o calendário e preserva os dados do compromisso", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const selector = screen.getByLabelText("Kalender für diesen Termin");
    expect(screen.getByRole("option", { name: "Microsoft 365 · Team (Nur lesen)" })).toBeDisabled();
    await user.selectOptions(selector, "exchange-work");
    expect(selector).toHaveValue("exchange-work");
    expect(screen.getByPlaceholderText("Titel hinzufügen")).toHaveValue("Fortbildung");
    expect(screen.getByLabelText("Startzeit")).toHaveValue("09:00");
    await user.selectOptions(selector, "local:DMH Backup");
    expect(selector).toHaveValue("local:DMH Backup");
  });
  it("alterna entre evento e série preservando as opções já escolhidas", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText("Erinnerung"), "30");
    await user.selectOptions(screen.getByLabelText("Kategorie"), "Fortbildung");
    await user.selectOptions(screen.getByLabelText("Sichtbarkeit"), "private");
    await user.selectOptions(screen.getByLabelText("Anzeigen als"), "oof");
    await user.click(screen.getByRole("button", { name: "Serie" }));
    expect(screen.getByLabelText("Serieneinstellungen")).toBeInTheDocument();
    expect(screen.getByLabelText("Wiederholung")).toHaveValue("weekly");

    await user.selectOptions(screen.getByLabelText("Wiederholung"), "monthly");
    await user.click(screen.getByRole("button", { name: "Serie" }));
    expect(screen.getByLabelText("Wiederholung")).toHaveValue("monthly");
    await user.click(screen.getByRole("button", { name: "Ereignis" }));
    expect(screen.queryByLabelText("Serieneinstellungen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ereignis" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Erinnerung")).toHaveValue("30");
    expect(screen.getByLabelText("Kategorie")).toHaveValue("Fortbildung");
    expect(screen.getByLabelText("Sichtbarkeit")).toHaveValue("private");
    expect(screen.getByLabelText("Anzeigen als")).toHaveValue("oof");
  });

  it("converte um compromisso em evento de dia inteiro e o mostra na faixa limpa do planejador", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: /Ganztägig/ }));

    expect(screen.queryByLabelText("Startzeit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Endzeit")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Startdatum")).toHaveValue("2026-09-24");
    expect(screen.getByLabelText("Enddatum")).toHaveValue("2026-09-24");
    expect(screen.getByLabelText("Ganztägige Termine")).toHaveTextContent("Fortbildung");
    expect(screen.getByRole("button", { name: /Speichern/ })).toBeEnabled();
  });
});
