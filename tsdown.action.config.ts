import { defineConfig } from "tsdown";

// Builds the committed GitHub Action entry point. Unlike the npm build (see
// `tsdown.config.ts`), the output lives in `action/` and is checked into git so
// the `runs.using: node` action can execute it without an install step.
export default defineConfig({
  entry: { index: "src/action.ts" },
  outDir: "action",
  format: ["esm"],
  target: "node22",
  platform: "node",
  // The language server is spawned as a subprocess from a vendored copy on disk
  // (see `TW_LINT_LANGUAGE_SERVER_ENTRY`), so it must stay external.
  external: ["@tailwindcss/language-server"],
  dts: false,
  clean: true,
  sourcemap: false,
});
