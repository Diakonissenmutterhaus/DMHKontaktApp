import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionResultDialog } from "./ActionResultDialog";

describe("ActionResultDialog", () => {
  beforeEach(() => localStorage.clear());

  it("persists the per-action choice to hide a repeated success dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const result = {
      title: "Kontakte verschoben",
      summary: "Der Kontakt ist jetzt in „Persönliches Adressbuch“.",
      tone: "success" as const,
      dismissalKey: "contacts-moved",
      dismissalLabel: "Diesen Hinweis beim Verschieben von Kontakten nicht mehr anzeigen"
    };

    render(<ActionResultDialog result={result} onClose={onClose} />);

    await user.click(screen.getByRole("checkbox", { name: result.dismissalLabel }));
    await user.click(screen.getByRole("button", { name: "Verstanden" }));

    expect(localStorage.getItem("agendakontakte.dismissedActionResult.contacts-moved")).toBe("true");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
