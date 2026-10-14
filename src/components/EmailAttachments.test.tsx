import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAttachments, attachmentBytes } from "./EmailAttachments";

const mocks = vi.hoisted(() => ({ invoke:vi.fn(), save:vi.fn() }));
vi.mock("../utils/notificationPolicy", () => ({ invokeWithDiagnostics:mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save:mocks.save }));
const unsupported = { index:1,name:"archive.zip",size:100,mimeType:"application/octet-stream",preview:"none",available:true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (command:string) => command === "list_email_archive_attachments" ? [unsupported] : null);
  mocks.save.mockResolvedValue("C:\\fixture\\attachment.zip");
});
describe("EmailAttachments", () => {
  it("keeps binary bytes intact", () => {
    expect([...attachmentBytes("AP8QgA==")]).toEqual([0,255,16,128]);
  });
  it("offers saving but does not execute or preview an unsupported file", async () => {
    render(<EmailAttachments messageId="message-one" />);
    expect(await screen.findByText("archive.zip")).toBeVisible();
    expect(screen.queryByRole("button", { name:/anzeigen/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name:"archive.zip speichern" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("save_email_archive_attachment", { id:"message-one",index:1,path:"C:\\fixture\\attachment.zip" }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("read_email_archive_attachment", expect.anything());
  });
  it("does not write a copy when the file picker is cancelled", async () => {
    mocks.save.mockResolvedValue(null);
    render(<EmailAttachments messageId="one" />);
    await userEvent.click(await screen.findByRole("button", { name:"archive.zip speichern" }));
    expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(["list_email_archive_attachments"]);
  });
  it("ignores a late preview response after selecting another message", async () => {
    let resolvePreview: (value:unknown) => void = () => undefined;
    const previewItem = { ...unsupported,name:"doc.pdf",preview:"pdf" };
    mocks.invoke.mockImplementation((command:string,args:any) => {
      if (command === "list_email_archive_attachments") return Promise.resolve(args.id === "one" ? [previewItem] : []);
      return new Promise(resolve => { resolvePreview = resolve; });
    });
    const page = render(<EmailAttachments messageId="one" />);
    await userEvent.click(await screen.findByRole("button", { name:"doc.pdf anzeigen" }));
    page.rerender(<EmailAttachments messageId="two" />);
    await act(async () => resolvePreview({ attachment:previewItem,base64:"JVBERg==" }));
    await waitFor(() => expect(screen.queryByText("doc.pdf")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
