// Copies the self-contained @tailwindcss/language-server package into the
// committed action bundle. The package has zero runtime dependencies and ships
// prebuilds for every platform, so a plain recursive copy is enough for the
// action to spawn it on any runner. Run after building the action bundle.
import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));

// Resolve the installed package root from its package.json.
const pkgJson = require.resolve("@tailwindcss/language-server/package.json");
const src = path.dirname(pkgJson);
const dest = path.join(root, "action", "vendor", "tailwindcss-language-server");

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });

console.log(
  `Vendored @tailwindcss/language-server -> ${path.relative(root, dest)}`,
);
