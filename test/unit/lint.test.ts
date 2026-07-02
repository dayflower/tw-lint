import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type {
  CodeAction,
  Diagnostic,
} from "vscode-languageserver-protocol/node";
import { DiagnosticSeverity } from "vscode-languageserver-protocol/node";
import { URI } from "vscode-uri";
import type { ValidationResult } from "../../src/client.js";
import {
  collectTargetFiles,
  type LintClient,
  lintDocument,
} from "../../src/lint.js";

function diagnostic(
  message: string,
  severity: DiagnosticSeverity,
  code?: string,
): Diagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    },
    severity,
    message,
    ...(code !== undefined ? { code } : {}),
  };
}

function fixAction(uri: string, newText: string): CodeAction {
  return {
    title: "fix",
    kind: "quickfix",
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 5 },
            },
            newText,
          },
        ],
      },
    },
  };
}

/** A quick-fix that replaces a single-line character range with `newText`. */
function rangeAction(
  uri: string,
  start: number,
  end: number,
  newText: string,
): CodeAction {
  return {
    title: "fix",
    kind: "quickfix",
    edit: {
      changes: {
        [uri]: [
          {
            range: {
              start: { line: 0, character: start },
              end: { line: 0, character: end },
            },
            newText,
          },
        ],
      },
    },
  };
}

const filePath = "/project/index.html";

describe("lintDocument", () => {
  it("maps diagnostics to messages and counts severities", async () => {
    const client: LintClient = {
      diagnostics: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [
          diagnostic("conflict", DiagnosticSeverity.Error, "cssConflict"),
          diagnostic("warn", DiagnosticSeverity.Warning, "invalidApply"),
        ],
      }),
      codeActions: async () => [],
      validate: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [],
      }),
    };

    const result = await lintDocument(
      client,
      { filePath, text: "hello" },
      "none",
    );

    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.messages.map((m) => m.rule)).toEqual([
      "cssConflict",
      "invalidApply",
    ]);
    expect(result.timedOut).toBeUndefined();
    expect(result.fixCount).toBeUndefined();
    expect(result.output).toBeUndefined();
  });

  it("marks a document whose validation times out", async () => {
    const client: LintClient = {
      diagnostics: async (): Promise<ValidationResult> => ({ kind: "timeout" }),
      codeActions: async () => [],
      validate: async (): Promise<ValidationResult> => ({ kind: "timeout" }),
    };

    const result = await lintDocument(
      client,
      { filePath, text: "hello" },
      "none",
    );

    expect(result.timedOut).toBe(true);
    expect(result.messages).toHaveLength(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("does not request code actions when fix mode is none", async () => {
    const codeActions = vi.fn(async () => []);
    const client: LintClient = {
      diagnostics: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [],
      }),
      codeActions,
      validate: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [],
      }),
    };

    await lintDocument(client, { filePath, text: "hello" }, "none");

    expect(codeActions).not.toHaveBeenCalled();
  });

  it("applies quick-fixes and re-validates without writing to disk", async () => {
    const uri = URI.file(filePath).toString();
    const diagnostics = vi
      .fn<(filePath: string) => Promise<ValidationResult>>()
      .mockResolvedValue({
        kind: "diagnostics",
        diagnostics: [
          diagnostic("conflict", DiagnosticSeverity.Warning, "cssConflict"),
        ],
      });
    const validate = vi
      .fn<(filePath: string, text: string) => Promise<ValidationResult>>()
      .mockResolvedValue({ kind: "diagnostics", diagnostics: [] });

    const client: LintClient = {
      diagnostics,
      codeActions: async () => [fixAction(uri, "WORLD")],
      validate,
    };

    const result = await lintDocument(
      client,
      { filePath, text: "hello world" },
      "dry-run",
    );

    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0]?.[1]).toBe("WORLD world");
    expect(result.fixCount).toBe(1);
    expect(result.output).toBe("WORLD world");
    // Remaining diagnostics come from the re-validation (now empty).
    expect(result.messages).toHaveLength(0);
  });

  it("loops fix passes until a pass stops changing the text", async () => {
    const uri = URI.file(filePath).toString();
    const diagnostics = vi
      .fn<(filePath: string) => Promise<ValidationResult>>()
      .mockResolvedValue({
        kind: "diagnostics",
        diagnostics: [
          diagnostic(
            "warn",
            DiagnosticSeverity.Warning,
            "suggestCanonicalClasses",
          ),
        ],
      });
    // Each pass fixes one more character; the third pass offers nothing.
    const codeActions = vi
      .fn()
      .mockResolvedValueOnce([rangeAction(uri, 0, 1, "x")])
      .mockResolvedValueOnce([rangeAction(uri, 2, 3, "x")])
      .mockResolvedValueOnce([]);
    const validate = vi
      .fn<(filePath: string, text: string) => Promise<ValidationResult>>()
      .mockResolvedValue({ kind: "diagnostics", diagnostics: [] });

    const client: LintClient = { diagnostics, codeActions, validate };

    const result = await lintDocument(
      client,
      { filePath, text: "1 2 3" },
      "dry-run",
    );

    expect(codeActions).toHaveBeenCalledTimes(3);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(result.fixCount).toBe(2);
    expect(result.output).toBe("x x 3");
  });

  it("applies a single pass when maxPasses is 1, leaving further-fixable problems", async () => {
    const uri = URI.file(filePath).toString();
    const remaining: ValidationResult = {
      kind: "diagnostics",
      diagnostics: [
        diagnostic(
          "warn",
          DiagnosticSeverity.Warning,
          "suggestCanonicalClasses",
        ),
      ],
    };
    // Every pass could fix something, but maxPasses caps it at one.
    const codeActions = vi
      .fn()
      .mockResolvedValue([rangeAction(uri, 0, 1, "x")]);
    const validate = vi
      .fn<(filePath: string, text: string) => Promise<ValidationResult>>()
      .mockResolvedValue(remaining);

    const client: LintClient = {
      diagnostics: async () => remaining,
      codeActions,
      validate,
    };

    const result = await lintDocument(
      client,
      { filePath, text: "1 2 3" },
      "dry-run",
      1,
    );

    expect(codeActions).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(result.fixCount).toBe(1);
    expect(result.output).toBe("x 2 3");
    // The still-fixable warning is reported (a second pass would fix it).
    expect(result.warningCount).toBe(1);
  });

  it("treats maxPasses of 0 as a single pass", async () => {
    const uri = URI.file(filePath).toString();
    const codeActions = vi
      .fn()
      .mockResolvedValue([rangeAction(uri, 0, 1, "x")]);

    const client: LintClient = {
      diagnostics: async () => ({
        kind: "diagnostics",
        diagnostics: [
          diagnostic(
            "warn",
            DiagnosticSeverity.Warning,
            "suggestCanonicalClasses",
          ),
        ],
      }),
      codeActions,
      validate: async () => ({
        kind: "diagnostics",
        diagnostics: [
          diagnostic(
            "warn",
            DiagnosticSeverity.Warning,
            "suggestCanonicalClasses",
          ),
        ],
      }),
    };

    const result = await lintDocument(
      client,
      { filePath, text: "1 2 3" },
      "dry-run",
      0,
    );

    expect(codeActions).toHaveBeenCalledTimes(1);
    expect(result.fixCount).toBe(1);
  });
});

describe("collectTargetFiles", () => {
  const fixtures = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
  );

  it("keeps only files with a known language id, sorted by path", async () => {
    const cwd = path.join(fixtures, "v4");
    const files = await collectTargetFiles(
      cwd,
      ["**/*"],
      ["**/node_modules/**"],
    );

    const paths = files.map((f) => f.filePath);
    expect(paths.length).toBeGreaterThan(0);
    // Sorted ascending.
    expect([...paths].sort((a, b) => a.localeCompare(b))).toEqual(paths);
    // Every kept file resolved to a language id.
    expect(files.every((f) => f.languageId.length > 0)).toBe(true);
    // The HTML fixture is included; resolves to the "html" language id.
    const html = files.find((f) => f.filePath.endsWith("index.html"));
    expect(html?.languageId).toBe("html");
  });
});
