import path from "node:path";
import { type FixMode, runLint } from "./lint.js";
import type { TailwindCssSettings } from "./settings.js";
import type { LintSummary } from "./types.js";

export interface RunCliOptions {
  /** Workspace root (absolute path). */
  cwd: string;
  /** Glob patterns to lint (empty falls back to the defaults). */
  globs: string[];
  settings: TailwindCssSettings;
  fix: FixMode;
  verbose?: boolean;
  /** Warning count that triggers a non-zero exit code. */
  maxWarnings?: string | number;
  /** Treat "no Tailwind project detected" as an error (exit 2). Default true. */
  errorOnNoProject?: boolean;
}

export interface RunCliResult {
  summary: LintSummary;
  exitCode: number;
  /**
   * Operational notes (timeouts, no project detected). Callers surface these
   * out-of-band (stderr for the CLI, `core.warning` for the Action).
   */
  notes: string[];
}

/**
 * Runs the linter and computes the exit code exactly as the CLI does, so both
 * the CLI and the GitHub Action share one implementation of the exit-code and
 * operational-failure semantics.
 */
export async function runCli(options: RunCliOptions): Promise<RunCliResult> {
  const summary = await runLint({
    cwd: options.cwd,
    patterns: options.globs,
    settings: options.settings,
    fix: options.fix,
    verbose: options.verbose,
  });

  const notes: string[] = [];

  // The exit code is computed from the unfiltered counts so that `--quiet` only
  // suppresses output and never weakens the `--max-warnings` threshold.
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
      .map(
        (result) =>
          path.relative(options.cwd, result.filePath) || result.filePath,
      )
      .join(", ");
    notes.push(
      `timed out waiting for diagnostics: ${files}. Results may be incomplete.`,
    );
    exitCode = 2;
  }

  // No detected project means nothing was actually linted. Unless the caller
  // opted out, treat it as an operational failure (exit 2) so a misconfigured
  // setup can't pass silently in CI.
  if (summary.noProjectDetected && options.errorOnNoProject !== false) {
    notes.push(
      "no Tailwind CSS project was detected for the linted files. " +
        "Nothing was linted.",
    );
    exitCode = 2;
  }

  return { summary, exitCode, notes };
}

export function resolveExitCode(
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
