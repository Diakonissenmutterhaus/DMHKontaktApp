import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailFolderTree } from "./EmailFolderTree";
import { buildEmailFolderTree } from "../utils/emailFolderTree";

afterEach(cleanup);
const nodes = buildEmailFolderTree([
  { id: "root", name: "Account", path: "Account", source: "thunderbird", sourceId: "one", count: 0 },
  { id: "inbox", name: "Inbox", path: "Account/Inbox", source: "thunderbird", sourceId: "one", count: 1 },
  { id: "nested", name: "Work", path: "Account/Inbox/Work", source: "thunderbird", sourceId: "one", count: 2 }
]);
describe("EmailFolderTree", () => {
  it("distinguishes IMAP and Exchange mailboxes with the same address without merging their folders", async () => {
    const address = "same@example.test", change = vi.fn();
    const accounts = buildEmailFolderTree([
      { id:"exchange-inbox", sourceId:"exchange", name:"Inbox", path:`${address}/Inbox`, source:"outlook", accountKind:"Exchange", count:55 },
      { id:"imap-inbox", sourceId:"imap", name:"Inbox", path:`${address}/Inbox`, source:"outlook", accountKind:"IMAP", count:19 }
    ]);
    render(<EmailFolderTree nodes={accounts} label="Sources" selectedSources={new Set(["imap"])} onSourceChange={change} />);
    expect(screen.getByRole("checkbox", { name:`${address} · Outlook · IMAP` })).toBeChecked();
    const exchange = screen.getByRole("checkbox", { name:`${address} · Outlook · Exchange` });
    expect(exchange).not.toBeChecked();
    await userEvent.click(exchange);
    expect(change).toHaveBeenCalledWith("exchange", true);
    expect(screen.getByText("IMAP")).toBeVisible();
    expect(screen.getByText("Exchange")).toBeVisible();
    expect(screen.getAllByText("Inbox")).toHaveLength(2);
  });
  it("expands and collapses individually and in bulk without selecting another folder", async () => {
    const select = vi.fn();
    render(<EmailFolderTree nodes={nodes} label="Folders" onSelect={select} />);
    await userEvent.click(await screen.findByRole("button", { name: "Inbox aufklappen" }));
    expect(screen.getByText("Work")).toBeVisible();
    expect(select).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Work"));
    expect(select).toHaveBeenCalledWith("nested");
    await userEvent.click(screen.getByRole("button", { name: "Alle Ordner zuklappen" }));
    expect(screen.queryByText("Inbox")).toBeNull();
    const root = within(screen.getByRole("tree", { name: "Folders" })).getByRole("treeitem");
    expect(root).toHaveAttribute("tabindex", "0");
    act(() => root.focus()); await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Inbox")).toBeVisible();
  });
  it("selects an account independently of expanding its folders", async () => {
    const change = vi.fn();
    render(<EmailFolderTree nodes={nodes} label="Sources" selectedSources={new Set(["one"])} onSourceChange={change} />);
    const checkbox = screen.getByRole("checkbox", { name: "Account" });
    await userEvent.click(checkbox);
    expect(change).toHaveBeenCalledWith("one", false);
    expect(screen.getByText("Inbox")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Account zuklappen" }));
    expect(change).toHaveBeenCalledTimes(1);
  });
  it("opens context menus with mouse or keyboard and requests only the chosen branch", async () => {
    const remove = vi.fn(), select = vi.fn(), search = vi.fn();
    render(<EmailFolderTree nodes={nodes} label="Folders" onSelect={select} onSearch={search} onRemove={remove} />);
    const root = screen.getByRole("treeitem", { name:"Account 3" });
    await userEvent.pointer({ target:root,keys:"[MouseRight]" });
    const menu = screen.getByRole("menu", { name:"Aktionen für Account" });
    expect(within(menu).queryByRole("menuitem", { name:"Öffnen" })).toBeNull();
    await userEvent.click(within(menu).getByRole("menuitem", { name:"Postfach aus Archiv entfernen …" }));
    expect(remove).toHaveBeenCalledWith(nodes[0]);
    expect(select).not.toHaveBeenCalled();
    const inbox = screen.getByRole("treeitem", { name:"Inbox 1" });
    act(() => inbox.focus());
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menu", { name:"Aktionen für Inbox" })).toBeVisible();
    await userEvent.click(screen.getByRole("menuitem", { name:"In diesem Ordner suchen" }));
    expect(search).toHaveBeenCalledWith("inbox");
    act(() => inbox.focus());
    await userEvent.keyboard("{Shift>}{F10}{/Shift}{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(inbox).toHaveFocus();
  });
  it("disables removal while an archive operation is running", async () => {
    render(<EmailFolderTree nodes={nodes} label="Folders" onRemove={vi.fn()} disabled />);
    await userEvent.pointer({ target:screen.getByText("Account"),keys:"[MouseRight]" });
    expect(screen.getByRole("menuitem", { name:"Postfach aus Archiv entfernen …" })).toBeDisabled();
  });
});
