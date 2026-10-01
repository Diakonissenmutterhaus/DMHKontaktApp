import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const theme = fs.readFileSync(path.join(root, "src/utils/theme.ts"), "utf8");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`CSS-Selektor fehlt: ${selector}`);
  const end = css.indexOf("}", start);
  if (end < 0) throw new Error(`CSS-Block ist unvollständig: ${selector}`);
  return css.slice(start, end + 1);
}

function variables(selector) {
  return new Map(
    [...block(selector).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [
      match[1],
      match[2]
    ])
  );
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

if (/:root\[data-(?:color-mode|accent)=/.test(css)) {
  throw new Error("Alternative Farbpaletten dürfen nicht mehr im CSS enthalten sein.");
}

const values = variables(":root");
for (const [foreground, background] of [
  ["text", "surface"],
  ["info-text", "info-surface"],
  ["danger-text", "danger-surface"],
  ["warning-text", "warning-surface"],
  ["success-text", "success-surface"]
]) {
  const ratio = contrast(values.get(foreground), values.get(background));
  if (ratio < 4.5) {
    throw new Error(
      `Standarddesign: Kontrast ${foreground}/${background} ist mit ${ratio.toFixed(2)} zu niedrig.`
    );
  }
}

const semanticBlocks = new Map([
  [".migration-capture-question", ["var(--info-surface)", "var(--info-text)"]],
  [".migration-capture-copy", ["var(--surface-alt)", "var(--text)"]],
  [".migration-capture-error", ["var(--danger-surface)", "var(--danger-text)"]],
  [".password-reveal-warning", ["var(--warning-surface)", "var(--warning-text)"]],
  [".vault-security-note", ["var(--success-surface)", "var(--success-text)"]]
]);

for (const [selector, tokens] of semanticBlocks) {
  const content = block(selector);
  for (const token of tokens) {
    if (!content.includes(token)) {
      throw new Error(`${selector} muss ${token} verwenden.`);
    }
  }
}

if (/agendakontakte\.theme\.|data-color-mode=|data-accent=/.test(html)) {
  throw new Error("Die Startseite darf keine alten Farbwünsche mehr laden.");
}
if (!theme.includes('dataset.colorMode = "light"') || !theme.includes('dataset.accent = "pink"')) {
  throw new Error("Das Standarddesign muss beim Start erzwungen werden.");
}

console.log("Das helle DMH-Standarddesign und seine Kontraste sind konsistent.");
