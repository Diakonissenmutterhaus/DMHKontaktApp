import { describe, expect, it, vi } from "vitest";
import { addBrowserDataToBackup, restoreBrowserDataFromBackup } from "./backup";
import { initializeTheme, obsoleteThemeStorageKeys } from "./theme";
import type { BackupData } from "../types/contact";

describe("fixed DMH appearance", () => {
  it("migrates existing dark and green preferences to light and pink on startup", () => {
    localStorage.setItem(obsoleteThemeStorageKeys[0], "dark");
    localStorage.setItem(obsoleteThemeStorageKeys[1], "green");
    document.documentElement.dataset.colorMode = "dark";
    document.documentElement.dataset.accent = "green";

    initializeTheme();

    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("pink");
    for (const key of obsoleteThemeStorageKeys) expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps the fixed palette even when WebView storage is unavailable", () => {
    const removeItem = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    document.documentElement.dataset.colorMode = "dark";
    document.documentElement.dataset.accent = "green";

    expect(() => initializeTheme()).not.toThrow();
    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("pink");
    removeItem.mockRestore();
  });

  it("does not restore or export obsolete appearance preferences from old backups", () => {
    const oldBrowserStorage = {
      [obsoleteThemeStorageKeys[0]]: "dark",
      [obsoleteThemeStorageKeys[1]]: "green",
      "dmh.contacts.fontSize": "18"
    };
    localStorage.setItem(obsoleteThemeStorageKeys[0], "dark");
    localStorage.setItem(obsoleteThemeStorageKeys[1], "green");

    restoreBrowserDataFromBackup({ browserStorage: oldBrowserStorage });

    for (const key of obsoleteThemeStorageKeys) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("dmh.contacts.fontSize")).toBe("18");
    const backup: BackupData = {
      version: "2.0.0",
      exportedAt: "2026-10-01T00:00:00Z",
      contacts: [],
      groups: [],
      settings: [],
      browserStorage: oldBrowserStorage
    };
    const exported = addBrowserDataToBackup(backup);
    for (const key of obsoleteThemeStorageKeys) expect(exported.browserStorage).not.toHaveProperty(key);
    expect(exported.browserStorage).toHaveProperty("dmh.contacts.fontSize", "18");
  });
});
