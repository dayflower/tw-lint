import path from "node:path";
import pc from "picocolors";
import type { Diagnostic } from "vscode-languageserver-protocol/node";
import type { LintMessage, LintResult, LintSummary } from "./types.js";

/** Converts LSP diagnostics to lint messages (1-based positions). */
export function toLintMessages(diagnostics: Diagnostic[]): LintMessage[] {
  return diagnostics.map((diag) => ({
    rule: diag.code != null ? String(diag.code) : null,
    severity: diag.severity === 1 ? "error" : "warning",
    message:
      typeof diag.message === "string" ? diag.message : String(diag.message),
    line: diag.range.start.line + 1,
    column: diag.range.start.character + 1,
    endLine: diag.range.end.line + 1,
    endColumn: diag.range.end.character + 1,
  }));
}

export function summarize(
  results: LintResult[],
  noProjectDetected: boolean,
): LintSummary {
  let errorCount = 0;
  let warningCount = 0;
  let fixCount = 0;
  for (const result of results) {
    errorCount += result.errorCount;
    warningCount += result.warningCount;
    fixCount += result.fixCount ?? 0;
  }
  return { results, errorCount, warningCount, fixCount, noProjectDetected };
}

export function formatText(summary: LintSummary, cwd: string): string {
  const lines: string[] = [];

  for (const result of summary.results) {
    if (result.messages.length === 0) continue;
    const relative = path.relative(cwd, result.filePath) || result.filePath;
    lines.push(pc.underline(relative));
    for (const message of result.messages) {
      lines.push(formatMessageLine(message));
    }
    lines.push("");
  }

  const { errorCount, warningCount, fixCount } = summary;
  const total = errorCount + warningCount;

  if (total > 0) {
    const color = errorCount > 0 ? pc.red : pc.yellow;
    lines.push(
      color(
        `✖ ${total} ${plural(total, "problem")} ` +
          `(${errorCount} ${plural(errorCount, "error")}, ${warningCount} ${plural(warningCount, "warning")})`,
      ),
    );
  } else if (!summary.noProjectDetected) {
    lines.push(pc.green("✔ No problems found"));
  }

  if (fixCount > 0) {
    lines.push(pc.green(`✔ ${fixCount} ${plural(fixCount, "issue")} fixed`));
  }

  if (summary.noProjectDetected) {
    lines.push(
      pc.yellow(
        "No Tailwind CSS project was detected for the linted files. " +
          'Ensure a Tailwind config (v3) or a CSS entrypoint importing "tailwindcss" (v4) exists in the workspace.',
      ),
    );
  }

  return lines.join("\n");
}

function formatMessageLine(message: LintMessage): string {
  const position = pc.dim(`${message.line}:${message.column}`);
  const severity =
    message.severity === "error" ? pc.red("error") : pc.yellow("warning");
  const rule = message.rule ? pc.dim(message.rule) : "";
  return `  ${position}  ${severity}  ${message.message}  ${rule}`.trimEnd();
}

export function formatJson(summary: LintSummary): string {
  return JSON.stringify(
    {
      errorCount: summary.errorCount,
      warningCount: summary.warningCount,
      fixCount: summary.fixCount,
      noProjectDetected: summary.noProjectDetected,
      results: summary.results.map((result) => ({
        filePath: result.filePath,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
        fixCount: result.fixCount ?? 0,
        messages: result.messages,
      })),
    },
    null,
    2,
  );
}

export function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
