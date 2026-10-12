import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionResultDialog } from "./ActionResultDialog";

describe("ActionResultDialog", () => {
  beforeEach(() => localStorage.clear());

  it("keeps routine successes out of user dialogs", async () => {
    const onClose = vi.fn();
    const result = {
      title: "Kontakte verschoben",
      summary: "Der Kontakt ist jetzt in „Persönliches Adressbuch“.",
      tone: "success" as const,
      dismissalKey: "contacts-moved",
      dismissalLabel: "Diesen Hinweis beim Verschieben von Kontakten nicht mehr anzeigen"
    };

    render(<ActionResultDialog result={result} onClose={onClose} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
