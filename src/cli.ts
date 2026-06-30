#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { cac } from "cac";
import { loadLinterConfig } from "./config.js";
import { type FixMode, runLint } from "./lint.js";
import { applyQuietFilter, formatJson, formatText } from "./reporter.js";
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
    .option("--format <format>", "Output format: text | json", {
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
    .option("--verbose", "Print language server diagnostics to stderr");

  cli.help();

  const parsed = cli.parse(process.argv, { run: false });

  if (parsed.options.help) {
    return 0;
  }

  const globs = parsed.args as string[];
  const options = parsed.options as CliOptions;

  const format = options.format === "json" ? "json" : "text";
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

  const summary = await runLint({
    cwd,
    patterns: globs,
    settings,
    fix,
    verbose: options.verbose,
  });

  // The exit code is computed from the unfiltered counts so that --quiet only
  // suppresses output and never weakens the --max-warnings threshold.
  let exitCode = resolveExitCode(
    summary.errorCount,
    summary.warningCount,
    options.maxWarnings,
  );

  // A timeout means the language server never reported diagnostics for one or
  // more files, so the results are incomplete. Treat that as an operational
  // failure (exit 2) that takes precedence over the lint-based exit codes,
  // rather than silently reporting those files as problem-free.
  if (summary.timedOutCount > 0) {
    const files = summary.results
      .filter((result) => result.timedOut)
      .map((result) => path.relative(cwd, result.filePath) || result.filePath)
      .join(", ");
    process.stderr.write(
      `tw-lint: timed out waiting for diagnostics: ${files}. ` +
        "Results may be incomplete.\n",
    );
    exitCode = 2;
  }

  const reported = options.quiet ? applyQuietFilter(summary) : summary;

  if (format === "json") {
    process.stdout.write(`${formatJson(reported)}\n`);
  } else {
    const text = formatText(reported, cwd);
    if (text.trim().length > 0) {
      process.stdout.write(`${text}\n`);
    }
  }

  return exitCode;
}

function resolveExitCode(
  errorCount: number,
  warningCount: number,
  maxWarnings: string | number | undefined,
): number {
  if (errorCount > 0) return 1;
  if (maxWarnings !== undefined) {
    const limit = Number(maxWarnings);
    if (Number.isFinite(limit) && warningCount > limit) return 1;
  }
  return 0;
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
