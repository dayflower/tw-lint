import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The language server needs a few seconds to detect and build a project.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each test starts its own server; avoid running them concurrently.
    fileParallelism: false,
    pool: "forks",
  },
});
