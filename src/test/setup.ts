import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 26 exposes its own Web Storage globals. Vitest 2 can preserve those
// instead of installing JSDOM's storage, so explicitly use the browser stores.
const browserWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
for (const key of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: browserWindow[key]
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: () => undefined
});
