import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bundle font/CMap/decoder resources locally. The viewer never needs a CDN.
const root = new URL("../", import.meta.url);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const source = fileURLToPath(new URL(`node_modules/pdfjs-dist/${directory}/`, root));
  const target = fileURLToPath(new URL(`public/pdfjs/${directory}/`, root));
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}
