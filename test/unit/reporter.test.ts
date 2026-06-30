import { describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-protocol/node";
import {
  formatJson,
  plural,
  summarize,
  toLintMessages,
} from "../../src/reporter.js";
import type { LintResult } from "../../src/types.js";

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    },
    message: "message",
    ...overrides,
  };
}

describe("toLintMessages", () => {
  it("converts zero-based positions to one-based", () => {
    const [message] = toLintMessages([
      diagnostic({
        range: {
          start: { line: 2, character: 5 },
          end: { line: 3, character: 1 },
        },
      }),
    ]);
    expect(message.line).toBe(3);
    expect(message.column).toBe(6);
    expect(message.endLine).toBe(4);
    expect(message.endColumn).toBe(2);
  });

  it("maps severity 1 to error and everything else to warning", () => {
    expect(toLintMessages([diagnostic({ severity: 1 })])[0].severity).toBe(
      "error",
    );
    expect(toLintMessages([diagnostic({ severity: 2 })])[0].severity).toBe(
      "warning",
    );
    expect(toLintMessages([diagnostic({ severity: 3 })])[0].severity).toBe(
      "warning",
    );
    expect(toLintMessages([diagnostic({})])[0].severity).toBe("warning");
  });

  it("uses null rule when code is missing and stringifies numeric codes", () => {
    expect(toLintMessages([diagnostic({})])[0].rule).toBeNull();
    expect(toLintMessages([diagnostic({ code: "cssConflict" })])[0].rule).toBe(
      "cssConflict",
    );
    expect(toLintMessages([diagnostic({ code: 42 })])[0].rule).toBe("42");
  });
});

describe("summarize", () => {
  function result(overrides: Partial<LintResult>): LintResult {
    return {
      filePath: "a.html",
      messages: [],
      errorCount: 0,
      warningCount: 0,
      ...overrides,
    };
  }

  it("aggregates counts across results", () => {
    const summary = summarize(
      [
        result({ errorCount: 1, warningCount: 2, fixCount: 1 }),
        result({ errorCount: 0, warningCount: 3 }),
      ],
      false,
    );
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(5);
    // Missing fixCount counts as zero.
    expect(summary.fixCount).toBe(1);
    expect(summary.noProjectDetected).toBe(false);
  });

  it("passes through the noProjectDetected flag", () => {
    expect(summarize([], true).noProjectDetected).toBe(true);
  });
});

describe("formatJson", () => {
  it("serialises the summary with a default fixCount", () => {
    const summary = summarize(
      [
        {
          filePath: "a.html",
          messages: [
            {
              rule: "cssConflict",
              severity: "warning",
              message: "m",
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 2,
            },
          ],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      false,
    );
    const json = JSON.parse(formatJson(summary));
    expect(json.warningCount).toBe(1);
    expect(json.results[0].fixCount).toBe(0);
    expect(json.results[0].messages).toHaveLength(1);
    expect(json.results[0].messages[0].rule).toBe("cssConflict");
  });
});

describe("plural", () => {
  it("returns the singular form for one", () => {
    expect(plural(1, "problem")).toBe("problem");
  });

  it("returns the plural form otherwise", () => {
    expect(plural(0, "problem")).toBe("problems");
    expect(plural(2, "issue")).toBe("issues");
  });
});
