import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { M365Loading, M365LoadingScope } from "./M365Loading";

describe("M365 loading window", () => {
  it("keeps one modal until all concurrent PC queries finish", async () => {
    const view = render(<M365LoadingScope><M365Loading active message="Konto laden" /><M365Loading active message="Profile lesen" /></M365LoadingScope>);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    view.rerender(<M365LoadingScope><M365Loading active={false} message="Konto laden" /><M365Loading active message="Profile lesen" /></M365LoadingScope>);
    expect(screen.getByRole("dialog", { name: "Profile lesen" })).toBeVisible();
    view.rerender(<M365LoadingScope><M365Loading active={false} message="Konto laden" /><M365Loading active={false} message="Profile lesen" /></M365LoadingScope>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("prioritizes real migration stages and restores focus and page access", async () => {
    const button = document.createElement("button"); document.body.append(button); button.focus();
    const view = render(<M365LoadingScope><M365Loading active message="Lesen" /><M365Loading active message="Konfigurieren" priority={10} value={3} label="Profil vorbereitet" /></M365LoadingScope>);
    expect(screen.getByRole("dialog", { name: "Konfigurieren" })).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "3");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "6");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Profil vorbereitet");
    await act(async () => view.unmount());
    expect(button).toHaveFocus(); button.remove();
  });
});
