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

const filePath = "/project/index.html";

describe("lintDocument", () => {
  it("maps diagnostics to messages and counts severities", async () => {
    const client: LintClient = {
      validate: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [
          diagnostic("conflict", DiagnosticSeverity.Error, "cssConflict"),
          diagnostic("warn", DiagnosticSeverity.Warning, "invalidApply"),
        ],
      }),
      codeActions: async () => [],
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
      validate: async (): Promise<ValidationResult> => ({ kind: "timeout" }),
      codeActions: async () => [],
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
      validate: async (): Promise<ValidationResult> => ({
        kind: "diagnostics",
        diagnostics: [],
      }),
      codeActions,
    };

    await lintDocument(client, { filePath, text: "hello" }, "none");

    expect(codeActions).not.toHaveBeenCalled();
  });

  it("applies quick-fixes and re-validates without writing to disk", async () => {
    const uri = URI.file(filePath).toString();
    const validate = vi
      .fn<(filePath: string, text: string) => Promise<ValidationResult>>()
      .mockResolvedValueOnce({
        kind: "diagnostics",
        diagnostics: [
          diagnostic("conflict", DiagnosticSeverity.Warning, "cssConflict"),
        ],
      })
      .mockResolvedValueOnce({ kind: "diagnostics", diagnostics: [] });

    const client: LintClient = {
      validate,
      codeActions: async () => [fixAction(uri, "WORLD")],
    };

    const result = await lintDocument(
      client,
      { filePath, text: "hello world" },
      "dry-run",
    );

    expect(validate).toHaveBeenCalledTimes(2);
    expect(validate.mock.calls[1]?.[1]).toBe("WORLD world");
    expect(result.fixCount).toBe(1);
    expect(result.output).toBe("WORLD world");
    // Remaining diagnostics come from the re-validation (now empty).
    expect(result.messages).toHaveLength(0);
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
