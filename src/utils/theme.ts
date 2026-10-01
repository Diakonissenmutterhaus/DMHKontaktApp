export const obsoleteThemeStorageKeys = [
  "agendakontakte.theme.colorMode",
  "agendakontakte.theme.accent"
] as const;

// The DMH appearance is fixed. Remove preferences left by older releases on
// every startup so an update also migrates existing installations.
export function initializeTheme(): void {
  document.documentElement.dataset.colorMode = "light";
  document.documentElement.dataset.accent = "pink";
  try {
    for (const key of obsoleteThemeStorageKeys) localStorage.removeItem(key);
  } catch {
    // The fixed CSS palette still works if WebView storage is unavailable.
  }
}
