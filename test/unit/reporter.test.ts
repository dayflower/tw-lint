import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-protocol/node";
import {
  applyQuietFilter,
  formatGithub,
  formatJson,
  plural,
  summarize,
  toLintMessages,
} from "../../src/reporter.js";
import type { LintMessage, LintResult } from "../../src/types.js";

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

describe("applyQuietFilter", () => {
  function message(severity: "error" | "warning"): LintMessage {
    return {
      rule: "cssConflict",
      severity,
      message: "m",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 2,
    };
  }

  function summary() {
    return summarize(
      [
        {
          filePath: "a.html",
          messages: [message("error"), message("warning")],
          errorCount: 1,
          warningCount: 1,
          fixCount: 2,
        },
      ],
      false,
    );
  }

  it("drops warnings from output and zeroes warning counts", () => {
    const filtered = applyQuietFilter(summary());
    expect(filtered.warningCount).toBe(0);
    expect(filtered.errorCount).toBe(1);
    expect(filtered.results[0].warningCount).toBe(0);
    expect(filtered.results[0].errorCount).toBe(1);
    expect(filtered.results[0].messages).toHaveLength(1);
    expect(filtered.results[0].messages[0].severity).toBe("error");
  });

  it("preserves fixCount and the noProjectDetected flag", () => {
    const filtered = applyQuietFilter(summary());
    expect(filtered.fixCount).toBe(2);
    expect(filtered.results[0].fixCount).toBe(2);
    expect(filtered.noProjectDetected).toBe(false);
  });

  it("does not mutate the original summary", () => {
    const original = summary();
    applyQuietFilter(original);
    expect(original.warningCount).toBe(1);
    expect(original.results[0].warningCount).toBe(1);
    expect(original.results[0].messages).toHaveLength(2);
  });
});

describe("formatGithub", () => {
  const original = process.env.GITHUB_WORKSPACE;

  beforeEach(() => {
    process.env.GITHUB_WORKSPACE = "/repo";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = original;
  });

  function message(overrides: Partial<LintMessage> = {}): LintMessage {
    return {
      rule: "cssConflict",
      severity: "warning",
      message: "m",
      line: 4,
      column: 17,
      endLine: 4,
      endColumn: 20,
      ...overrides,
    };
  }

  it("emits one workflow command per message, relative to GITHUB_WORKSPACE", () => {
    const summary = summarize(
      [
        {
          filePath: "/repo/src/index.html",
          messages: [
            message({ severity: "error", message: "bad" }),
            message({ severity: "warning", rule: null, message: "meh" }),
          ],
          errorCount: 1,
          warningCount: 1,
        },
      ],
      false,
    );
    const lines = formatGithub(summary, "/somewhere/else").split("\n");
    expect(lines[0]).toBe(
      "::error file=src/index.html,line=4,endLine=4,col=17,endColumn=20::[cssConflict] bad",
    );
    // A null rule omits the "[rule] " prefix.
    expect(lines[1]).toBe(
      "::warning file=src/index.html,line=4,endLine=4,col=17,endColumn=20::meh",
    );
  });

  it("escapes newlines in the message and special chars in the path", () => {
    const summary = summarize(
      [
        {
          filePath: "/repo/a,b:c.html",
          messages: [message({ rule: null, message: "line1\nline2" })],
          errorCount: 0,
          warningCount: 1,
        },
      ],
      false,
    );
    const line = formatGithub(summary, "/repo");
    expect(line).toContain("file=a%2Cb%3Ac.html");
    expect(line).toContain("::line1%0Aline2");
  });

  it("returns an empty string when there are no messages", () => {
    expect(formatGithub(summarize([], false), "/repo")).toBe("");
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
