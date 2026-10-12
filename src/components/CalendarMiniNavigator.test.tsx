import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarMiniNavigator } from "./CalendarMiniNavigator";

const selected = new Date(2026, 9, 12);
describe("CalendarMiniNavigator", () => {
  it("browses two months independently and selects dates without changing the active view", async () => {
    const user=userEvent.setup(); const select=vi.fn(); const week=vi.fn();
    render(<CalendarMiniNavigator selectedDate={selected} view="week" onSelectDate={select} onSelectWeek={week} />);
    expect(screen.getByRole("grid",{name:"Oktober 2026"})).toBeVisible();
    expect(screen.getByRole("grid",{name:"November 2026"})).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Nächster Monat im Mini-Kalender"}));
    expect(screen.getByRole("grid",{name:"Dezember 2026"})).toBeVisible(); expect(select).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("grid",{name:"November 2026"})).getByRole("button",{name:"Donnerstag, 12. November 2026"}));
    expect(select).toHaveBeenCalledWith(new Date(2026,10,12)); expect(week).not.toHaveBeenCalled();
  });
  it("selects ISO weeks across the year boundary and uses the year/month chooser", async () => {
    const user=userEvent.setup();const select=vi.fn();const week=vi.fn();
    render(<CalendarMiniNavigator selectedDate={selected} view="day" onSelectDate={select} onSelectWeek={week} />);
    await user.click(screen.getByRole("button",{name:"Monat und Jahr auswählen, Oktober 2026"}));
    await user.clear(screen.getByRole("spinbutton",{name:"Jahr"})); await user.type(screen.getByRole("spinbutton",{name:"Jahr"}),"2020");
    await user.click(screen.getByRole("button",{name:"Dez"}));
    expect(select).not.toHaveBeenCalled();
    const january=screen.getByRole("grid",{name:"Januar 2021"});
    await user.click(within(january).getByRole("button",{name:"Kalenderwoche 53 auswählen, ab Montag, 28. Dezember 2020"}));
    expect(week).toHaveBeenCalledWith(new Date(2020,11,28));
  });
  it("highlights the whole week, clamps keyboard month navigation, and follows main-calendar dates", async () => {
    const select=vi.fn(); const week=vi.fn();const january=new Date(2027,0,31);
    const {rerender}=render(<CalendarMiniNavigator selectedDate={january} view="week" onSelectDate={select} onSelectWeek={week} />);
    const grid=screen.getByRole("grid",{name:"Januar 2027"});
    const day=within(grid).getByRole("button",{name:"Sonntag, 31. Januar 2027"});
    expect(day.closest('[role="row"]')?.querySelectorAll('[role="gridcell"][aria-selected="true"]')).toHaveLength(7);
    fireEvent.keyDown(day,{key:"PageDown"});
    expect(select).toHaveBeenLastCalledWith(new Date(2027,1,28));
    rerender(<CalendarMiniNavigator selectedDate={new Date(2028,7,8)} view="day" onSelectDate={select} onSelectWeek={week} />);
    expect(screen.getByRole("grid",{name:"August 2028"})).toBeVisible();
    const user=userEvent.setup();await user.click(screen.getByRole("button",{name:"Mini-Kalender einklappen"}));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Mini-Kalender ausklappen"}));
    expect(screen.getByRole("grid",{name:"September 2028"})).toBeVisible();
  });
});
