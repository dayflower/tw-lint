import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTailwindSettings,
  loadLinterConfig,
  runLint,
} from "../../src/index.js";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
);

function rules(messages: { rule: string | null }[]): (string | null)[] {
  return messages.map((m) => m.rule);
}

describe("runLint (v4 project)", () => {
  const cwd = path.join(fixtures, "v4");

  it("detects conflicting utilities in an HTML file", async () => {
    const summary = await runLint({
      cwd,
      patterns: ["index.html"],
      settings: createTailwindSettings(),
    });

    expect(summary.noProjectDetected).toBe(false);
    expect(summary.results).toHaveLength(1);
    expect(rules(summary.results[0].messages)).toContain("cssConflict");
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  it("honours per-rule severity overrides", async () => {
    const summary = await runLint({
      cwd,
      patterns: ["index.html"],
      settings: createTailwindSettings({ rules: { cssConflict: "error" } }),
    });

    expect(summary.errorCount).toBeGreaterThan(0);
    expect(
      summary.results[0].messages.every((m) =>
        m.rule === "cssConflict" ? m.severity === "error" : true,
      ),
    ).toBe(true);
  });
});

describe("runLint (v3 project)", () => {
  const cwd = path.join(fixtures, "v3");

  it("detects conflicting utilities with a JS config", async () => {
    const summary = await runLint({
      cwd,
      patterns: ["index.html"],
      settings: createTailwindSettings(),
    });

    expect(summary.noProjectDetected).toBe(false);
    expect(rules(summary.results[0].messages)).toContain("cssConflict");
  });
});

describe("runLint (no project)", () => {
  it("reports that no Tailwind project was detected", async () => {
    const summary = await runLint({
      cwd: path.join(fixtures, "none"),
      patterns: ["index.html"],
      settings: createTailwindSettings(),
      projectTimeoutMs: 4_000,
    });

    expect(summary.noProjectDetected).toBe(true);
    expect(summary.results[0].messages).toHaveLength(0);
  });
});

describe("config file", () => {
  const cwd = path.join(fixtures, "v4");
  const configPath = path.join(cwd, "tw-lint.config.json");

  afterEach(() => {
    if (existsSync(configPath)) rmSync(configPath);
  });

  it("loads rule severities from a config file", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ rules: { cssConflict: "error" } }),
    );
    const { overrides, source } = await loadLinterConfig(cwd);

    expect(source).toBe(configPath);
    expect(overrides.rules).toEqual({ cssConflict: "error" });
  });

  it("applies config-file severities when linting", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ rules: { cssConflict: "error" } }),
    );
    const { overrides } = await loadLinterConfig(cwd);

    const summary = await runLint({
      cwd,
      patterns: ["index.html"],
      settings: createTailwindSettings(overrides),
    });

    expect(summary.errorCount).toBeGreaterThan(0);
    expect(summary.warningCount).toBe(0);
  });

  it("lets a CLI --severity override take precedence over the config file", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ rules: { cssConflict: "error" } }),
    );
    const { overrides } = await loadLinterConfig(cwd);

    // Simulate `--severity cssConflict=warning` layered on top of the file.
    const settings = createTailwindSettings({
      ...overrides,
      rules: { ...overrides.rules, cssConflict: "warning" },
    });
    const summary = await runLint({ cwd, patterns: ["index.html"], settings });

    expect(summary.errorCount).toBe(0);
    expect(summary.warningCount).toBeGreaterThan(0);
  });

  it("rejects an unknown rule name", async () => {
    writeFileSync(configPath, JSON.stringify({ rules: { nope: "error" } }));
    await expect(loadLinterConfig(cwd)).rejects.toThrow(/Unknown rule "nope"/);
  });
});

describe("runLint --fix", () => {
  const cwd = path.join(fixtures, "v4");
  const tmpName = "_fix_target.html";
  const tmpPath = path.join(cwd, tmpName);

  afterEach(() => {
    if (existsSync(tmpPath)) rmSync(tmpPath);
  });

  it("dry-run computes fixes without modifying the file", async () => {
    const content = '<div class="p-2 p-4 block flex"></div>\n';
    writeFileSync(tmpPath, content);

    const summary = await runLint({
      cwd,
      patterns: [tmpName],
      settings: createTailwindSettings(),
      fix: "dry-run",
    });

    expect(summary.fixCount).toBeGreaterThan(0);
    expect(readFileSync(tmpPath, "utf8")).toBe(content);
  });

  it("apply writes fixes to the file and reduces problems", async () => {
    const content = '<div class="p-2 p-4 block flex"></div>\n';
    writeFileSync(tmpPath, content);

    const before = await runLint({
      cwd,
      patterns: [tmpName],
      settings: createTailwindSettings(),
    });

    const fixed = await runLint({
      cwd,
      patterns: [tmpName],
      settings: createTailwindSettings(),
      fix: "apply",
    });

    expect(fixed.fixCount).toBeGreaterThan(0);
    expect(readFileSync(tmpPath, "utf8")).not.toBe(content);

    const after = await runLint({
      cwd,
      patterns: [tmpName],
      settings: createTailwindSettings(),
    });
    expect(after.warningCount).toBeLessThan(before.warningCount);
  });
});
