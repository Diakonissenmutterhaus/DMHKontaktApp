import { expect, test, type Page } from "@playwright/test";

// Render the production updater with a mocked native boundary; never run an
// actual installer or change this developer PC while checking the interaction.
async function openUpdater(page: Page, canSelfUpdate: boolean) {
  await page.addInitScript(({ allowed }) => {
    const state = window as unknown as Record<string, any>;
    state.isTauri = true;
    state.updateCommands = [];
    state.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
      invoke: async (command: string, args: any) => {
        state.updateCommands.push(command);
        if (command === "plugin:updater|check") return {
          rid: 42, currentVersion: "0.1.43", version: "0.1.44", body: "", rawJson: {},
        };
        if (command === "get_app_update_policy") return { canSelfUpdate: allowed, reason: allowed ? "per_user_nsis" : "managed_msi" };
        if (command === "install_app_update") {
          state.emitUpdate = (event: unknown) => args.onEvent.onmessage(event);
          return new Promise(() => {});
        }
        return null;
      },
    };
  }, { allowed: canSelfUpdate });
  await page.route("**/src/main.tsx", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /import App from ["'][^"']+["'];/,
      'import { UpdateNotifier as App } from "/src/components/UpdateNotifier.tsx";',
    );
    await route.fulfill({ response, body });
  });
  await page.goto("/");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "background"; button.textContent = "Hintergrund"; document.body.append(button);
  });
  await page.getByRole("button", { name: "Jetzt aktualisieren" }).click();
}

test("update stays centered and modal through download and installation", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openUpdater(page, true);
  const dialog = page.getByRole("dialog", { name: "DMH Backup aktualisieren" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.evaluate(() => (window as any).emitUpdate({ event: "Started", data: { contentLength: 1000 } }));
  await page.evaluate(() => (window as any).emitUpdate({ event: "Progress", data: { chunkLength: 450 } }));
  await expect(page.getByRole("progressbar")).toHaveAttribute("value", "45");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.mouse.wheel(0, 900);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - viewport.height / 2)).toBeLessThan(2);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.locator("#background").evaluate((element: HTMLElement) => element.focus());
  await expect(dialog).toBeFocused();
  await page.evaluate(() => (window as any).emitUpdate({ event: "Installing" }));
  await expect(page.getByRole("status")).toContainText("wird installiert");
  await expect(page.getByRole("progressbar")).not.toHaveAttribute("value");
  await page.screenshot({ path: testInfo.outputPath("update-loading.png") });
  expect(errors).toEqual([]);
});

test("managed MSI never invokes installation from the app", async ({ page }) => {
  await openUpdater(page, false);
  await expect(page.getByRole("dialog", { name: "Update" })).toContainText("Updates durch die EDV");
  const commands = await page.evaluate(() => (window as any).updateCommands as string[]);
  expect(commands).toContain("get_app_update_policy");
  expect(commands).not.toContain("install_app_update");
  expect(commands).not.toContain("plugin:updater|download_and_install");
  expect(commands).not.toContain("restart_app");
});
