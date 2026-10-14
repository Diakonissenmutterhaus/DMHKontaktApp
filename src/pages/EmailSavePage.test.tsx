import { describe, expect, it } from "vitest";
import { emailHtmlAsText } from "./EmailSavePage";

describe("emailHtmlAsText", () => {
  it("reads HTML as inert text without scripts, trackers or executable links", () => {
    const text = emailHtmlAsText('<html><head><style>.secret { display:none }</style></head><body><p>Olá, Julius</p><p>Segunda linha<br>Terceira linha</p><img src="https://tracker.example/pixel"><script>window.mailExecuted=true</script><iframe src="https://tracker.example/"></iframe><a href="javascript:alert(1)">Texto do link</a></body></html>');
    expect(text).toContain("Olá, Julius");
    expect(text).toContain("Segunda linha");
    expect(text).toContain("Terceira linha");
    expect(text).toContain("Texto do link");
    expect(text).not.toContain("mailExecuted");
    expect(text).not.toContain("display:none");
    expect(document.querySelector("img,iframe,script")).toBeNull();
  });
});
