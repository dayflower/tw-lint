import { describe, expect, it } from "vitest";
import type {
  CodeAction,
  Range,
  TextEdit,
} from "vscode-languageserver-protocol/node";
import { URI } from "vscode-uri";
import {
  applyTextEdits,
  collectFixEdits,
  rangesOverlap,
} from "../../src/fix.js";

function range(
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Range {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

function edit(
  newText: string,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): TextEdit {
  return { range: range(startLine, startChar, endLine, endChar), newText };
}

describe("applyTextEdits", () => {
  it("applies multiple edits back-to-front so offsets stay valid", () => {
    const text = "hello world";
    const result = applyTextEdits(text, [
      edit("HELLO", 0, 0, 0, 5),
      edit("WORLD", 0, 6, 0, 11),
    ]);
    expect(result).toBe("HELLO WORLD");
  });

  it("supports edits spanning multiple lines", () => {
    const text = "line1\nline2\nline3";
    const result = applyTextEdits(text, [edit("X", 0, 4, 2, 1)]);
    expect(result).toBe("lineXine3");
  });

  it("clamps a character beyond the line to the document end", () => {
    expect(applyTextEdits("abc", [edit("!", 0, 99, 0, 99)])).toBe("abc!");
  });
});

describe("rangesOverlap", () => {
  it("treats touching ranges on the same line as non-overlapping", () => {
    expect(rangesOverlap(range(0, 0, 0, 5), range(0, 5, 0, 10))).toBe(false);
    expect(rangesOverlap(range(0, 5, 0, 10), range(0, 0, 0, 5))).toBe(false);
  });

  it("detects overlap on the same line", () => {
    expect(rangesOverlap(range(0, 0, 0, 5), range(0, 4, 0, 10))).toBe(true);
  });

  it("treats line-separated ranges as non-overlapping", () => {
    expect(rangesOverlap(range(0, 0, 0, 5), range(1, 0, 1, 5))).toBe(false);
  });

  it("detects overlap spanning lines", () => {
    expect(rangesOverlap(range(0, 0, 2, 0), range(1, 0, 3, 0))).toBe(true);
  });
});

describe("collectFixEdits", () => {
  const targetUri = URI.file("/project/index.html").toString();

  function action(overrides: Partial<CodeAction>): CodeAction {
    return { title: "fix", kind: "quickfix", ...overrides };
  }

  it("collects edits from the `changes` map for the target uri", () => {
    const e = edit("flex", 0, 0, 0, 5);
    const edits = collectFixEdits(
      [action({ edit: { changes: { [targetUri]: [e] } } })],
      targetUri,
    );
    expect(edits).toEqual([e]);
  });

  it("collects edits from `documentChanges` for the target uri", () => {
    const e = edit("flex", 0, 0, 0, 5);
    const edits = collectFixEdits(
      [
        action({
          edit: {
            documentChanges: [
              { textDocument: { uri: targetUri, version: 1 }, edits: [e] },
            ],
          },
        }),
      ],
      targetUri,
    );
    expect(edits).toEqual([e]);
  });

  it("skips actions whose kind is not a quick fix", () => {
    const e = edit("flex", 0, 0, 0, 5);
    const edits = collectFixEdits(
      [action({ kind: "refactor", edit: { changes: { [targetUri]: [e] } } })],
      targetUri,
    );
    expect(edits).toEqual([]);
  });

  it("skips edits targeting a different uri", () => {
    const other = URI.file("/project/other.html").toString();
    const e = edit("flex", 0, 0, 0, 5);
    const edits = collectFixEdits(
      [action({ edit: { changes: { [other]: [e] } } })],
      targetUri,
    );
    expect(edits).toEqual([]);
  });

  it("keeps the first edit and skips a later overlapping one", () => {
    const first = edit("a", 0, 0, 0, 5);
    const overlapping = edit("b", 0, 4, 0, 10);
    const edits = collectFixEdits(
      [
        action({ edit: { changes: { [targetUri]: [first] } } }),
        action({ edit: { changes: { [targetUri]: [overlapping] } } }),
      ],
      targetUri,
    );
    expect(edits).toEqual([first]);
  });
});
