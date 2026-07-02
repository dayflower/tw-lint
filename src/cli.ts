#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { cac } from "cac";
import { loadLinterConfig } from "./config.js";
import type { FixMode } from "./lint.js";
import {
  applyQuietFilter,
  formatGithub,
  formatJson,
  formatText,
} from "./reporter.js";
import { runCli } from "./run.js";
import { createTailwindSettings, parseRuleOverride } from "./settings.js";
import type { RuleName, RuleSeverity } from "./types.js";

interface CliOptions {
  cwd?: string;
  format?: string;
  severity?: string | string[];
  config?: string;
  tailwindConfig?: string;
  maxWarnings?: string | number;
  quiet?: boolean;
  fix?: boolean;
  fixDryRun?: boolean;
  errorOnNoProject?: boolean;
  verbose?: boolean;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function main(): Promise<number> {
  const cli = cac("tw-lint");

  cli
    .command("[...globs]", "Lint files for Tailwind CSS problems")
    .option("--cwd <dir>", "Project root directory", { default: process.cwd() })
    .option("--format <format>", "Output format: text | json | github", {
      default: "text",
    })
    .option("-c, --config <file>", "Path to a linter config file (JSON)")
    .option("--severity <rule=level>", "Override a rule severity (repeatable)")
    .option("--tailwind-config <file>", "Force a specific Tailwind config file")
    .option(
      "--max-warnings <n>",
      "Number of warnings to trigger a non-zero exit code",
    )
    .option("--quiet", "Report errors only")
    .option("--fix", "Automatically fix problems and write changes to files")
    .option("--fix-dry-run", "Compute fixes without writing changes to files")
    .option(
      "--no-error-on-no-project",
      "Exit 0 (instead of 2) when no Tailwind project is detected",
    )
    .option("--verbose", "Print language server diagnostics to stderr");

  cli.help();

  const parsed = cli.parse(process.argv, { run: false });

  if (parsed.options.help) {
    return 0;
  }

  const globs = parsed.args as string[];
  const options = parsed.options as CliOptions;

  const format =
    options.format === "json"
      ? "json"
      : options.format === "github"
        ? "github"
        : "text";
  const cwd = path.resolve(options.cwd ?? process.cwd());

  // Config file provides the base; CLI flags override it.
  const { overrides } = await loadLinterConfig(cwd, options.config);

  const cliRules: Partial<Record<RuleName, RuleSeverity>> = {};
  for (const entry of asArray(options.severity)) {
    const [rule, severity] = parseRuleOverride(entry);
    cliRules[rule] = severity;
  }
  overrides.rules = { ...overrides.rules, ...cliRules };

  if (options.tailwindConfig) overrides.configFile = options.tailwindConfig;

  const settings = createTailwindSettings(overrides);

  const fix: FixMode = options.fixDryRun
    ? "dry-run"
    : options.fix
      ? "apply"
      : "none";

  const { summary, exitCode, notes } = await runCli({
    cwd,
    globs,
    settings,
    fix,
    verbose: options.verbose,
    maxWarnings: options.maxWarnings,
    errorOnNoProject: options.errorOnNoProject,
  });

  for (const note of notes) {
    process.stderr.write(`tw-lint: ${note}\n`);
  }

  const reported = options.quiet ? applyQuietFilter(summary) : summary;

  if (format === "json") {
    process.stdout.write(`${formatJson(reported)}\n`);
  } else if (format === "github") {
    const text = formatGithub(reported, cwd);
    if (text.length > 0) {
      process.stdout.write(`${text}\n`);
    }
  } else {
    const text = formatText(reported, cwd);
    if (text.trim().length > 0) {
      process.stdout.write(`${text}\n`);
    }
  }

  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tw-lint: ${message}\n`);
    process.exitCode = 2;
  });
