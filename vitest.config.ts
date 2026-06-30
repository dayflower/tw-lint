import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          // The language server needs a few seconds to detect and build a project.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Each test starts its own server; avoid running them concurrently.
          fileParallelism: false,
          pool: "forks",
        },
      },
    ],
  },
});
