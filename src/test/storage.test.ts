import { describe, expect, it } from "vitest";

describe("browser storage in component tests", () => {
  it("shares the JSDOM stores through both browser and global access", () => {
    const browserWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
    localStorage.setItem("local-storage-regression", "local");
    sessionStorage.setItem("session-storage-regression", "session");
    expect(window.localStorage).toBe(browserWindow.localStorage);
    expect(window.sessionStorage).toBe(browserWindow.sessionStorage);
    expect(browserWindow.localStorage.getItem("local-storage-regression")).toBe("local");
    expect(browserWindow.sessionStorage.getItem("session-storage-regression")).toBe("session");
  });
});
