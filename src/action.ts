import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { loadLinterConfig } from "./config.js";
import type { FixMode } from "./lint.js";
import { applyQuietFilter, formatGithub, formatText } from "./reporter.js";
import { runCli } from "./run.js";
import { createTailwindSettings, parseRuleOverride } from "./settings.js";
import type { RuleName, RuleSeverity } from "./types.js";

/**
 * Points the language client at the language server vendored next to this bundle
 * (`action/vendor/...`), which is not reachable via node_modules resolution from
 * the committed bundle. Respects an explicit override and falls back silently
 * when the vendored copy is absent (e.g. running from source).
 */
function useVendoredLanguageServer(): void {
  if (process.env.TW_LINT_LANGUAGE_SERVER_ENTRY) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const entry = path.join(
    here,
    "vendor",
    "tailwindcss-language-server",
    "bin",
    "tailwindcss-language-server",
  );
  if (existsSync(entry)) process.env.TW_LINT_LANGUAGE_SERVER_ENTRY = entry;
}

/** Reads a boolean input, treating an empty value as `fallback`. */
function getBoolean(name: string, fallback: boolean): boolean {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Reads an optional string input, returning undefined when empty. */
function getOptional(name: string): string | undefined {
  const raw = core.getInput(name).trim();
  return raw === "" ? undefined : raw;
}

async function main(): Promise<void> {
  useVendoredLanguageServer();

  // `globs` accepts whitespace- or newline-separated patterns.
  const globs = core
    .getInput("globs")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const workingDirectory = getOptional("working-directory") ?? ".";
  const cwd = path.resolve(process.cwd(), workingDirectory);

  // Config file provides the base; action inputs override it.
  const { overrides } = await loadLinterConfig(cwd, getOptional("config"));

  const cliRules: Partial<Record<RuleName, RuleSeverity>> = {};
  for (const entry of core.getMultilineInput("severity")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const [rule, severity] = parseRuleOverride(trimmed);
    cliRules[rule] = severity;
  }
  overrides.rules = { ...overrides.rules, ...cliRules };

  const tailwindConfig = getOptional("tailwind-config");
  if (tailwindConfig) overrides.configFile = tailwindConfig;

  const settings = createTailwindSettings(overrides);

  const fix: FixMode = getBoolean("fix-dry-run", false)
    ? "dry-run"
    : getBoolean("fix", false)
      ? "apply"
      : "none";

  const quiet = getBoolean("quiet", false);
  const maxWarnings = getOptional("max-warnings");
  const errorOnNoProject = getBoolean("error-on-no-project", true);

  const { summary, exitCode, notes } = await runCli({
    cwd,
    globs,
    settings,
    fix,
    verbose: getBoolean("verbose", false),
    maxWarnings,
    errorOnNoProject,
  });

  for (const note of notes) core.warning(note);

  const reported = quiet ? applyQuietFilter(summary) : summary;

  // Emit workflow commands so problems appear as inline annotations, and a
  // human-readable summary in the run log.
  const annotations = formatGithub(reported, cwd);
  if (annotations.length > 0) process.stdout.write(`${annotations}\n`);

  const text = formatText(reported, cwd);
  if (text.trim().length > 0) core.info(text);

  core.setOutput("error-count", summary.errorCount);
  core.setOutput("warning-count", summary.warningCount);
  core.setOutput("fix-count", summary.fixCount);

  if (exitCode !== 0) {
    core.setFailed(
      `tw-lint found problems (${summary.errorCount} error(s), ` +
        `${summary.warningCount} warning(s)).`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(`tw-lint: ${message}`);
});
