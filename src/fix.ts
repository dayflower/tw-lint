import {
  CodeAction,
  type Command,
  type Range,
  type TextEdit,
} from "vscode-languageserver-protocol/node";
import { normalizeUri } from "./uri.js";

/** Converts a zero-based LSP position to an absolute string offset. */
function offsetAt(text: string, line: number, character: number): number {
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
    currentLine++;
  }
  return Math.min(offset + character, text.length);
}

/**
 * Applies a set of LSP text edits to `text`. Edits are applied from the end of
 * the document backwards so earlier offsets remain valid.
 */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => {
    const aStart = offsetAt(text, a.range.start.line, a.range.start.character);
    const bStart = offsetAt(text, b.range.start.line, b.range.start.character);
    return bStart - aStart;
  });

  let result = text;
  for (const edit of sorted) {
    const start = offsetAt(
      result,
      edit.range.start.line,
      edit.range.start.character,
    );
    const end = offsetAt(result, edit.range.end.line, edit.range.end.character);
    result = result.slice(0, start) + edit.newText + result.slice(end);
  }
  return result;
}

/** True when two ranges overlap or touch in a conflicting way. */
export function rangesOverlap(a: Range, b: Range): boolean {
  const beforeOrTouch =
    a.end.line < b.start.line ||
    (a.end.line === b.start.line && a.end.character <= b.start.character);
  const afterOrTouch =
    b.end.line < a.start.line ||
    (b.end.line === a.start.line && b.end.character <= a.start.character);
  return !(beforeOrTouch || afterOrTouch);
}

/** A quick-fix edit together with the metadata needed to report it. */
export interface AppliedFix {
  edit: TextEdit;
  /** The code action title, e.g. "Replace with 'w-xl'". */
  title: string;
  /** Rule of the diagnostic the fix addresses, or null if unknown. */
  rule: string | null;
  /** 0-based line of the fixed location (diagnostic start, else edit start). */
  line: number;
  /** 0-based character of the fixed location. */
  character: number;
}

/**
 * Collects the non-overlapping quick-fixes that target `targetUri` from a list
 * of code actions, keeping each edit's title/rule/location. Overlapping edits
 * (e.g. two fixes touching the same class) are skipped to avoid producing broken
 * output in a single pass; the remaining issues are picked up on a later pass.
 */
export function collectAppliedFixes(
  actions: (Command | CodeAction)[],
  targetUri: string,
): AppliedFix[] {
  const normalizedTarget = normalizeUri(targetUri);
  const fixes: AppliedFix[] = [];

  for (const action of actions) {
    if (!CodeAction.is(action)) continue;
    if (action.kind && !action.kind.startsWith("quickfix")) continue;
    const changes = collectEditsForUri(action, normalizedTarget);
    for (const edit of changes) {
      if (
        fixes.some((existing) => rangesOverlap(existing.edit.range, edit.range))
      )
        continue;
      const diagnostic = action.diagnostics?.[0];
      const position = diagnostic?.range.start ?? edit.range.start;
      fixes.push({
        edit,
        title: action.title,
        rule: diagnostic?.code != null ? String(diagnostic.code) : null,
        line: position.line,
        character: position.character,
      });
    }
  }

  return fixes;
}

/**
 * Collects the non-overlapping quick-fix text edits that target `targetUri`.
 * Thin wrapper over {@link collectAppliedFixes} for callers that only need the
 * edits.
 */
export function collectFixEdits(
  actions: (Command | CodeAction)[],
  targetUri: string,
): TextEdit[] {
  return collectAppliedFixes(actions, targetUri).map((fix) => fix.edit);
}

function collectEditsForUri(
  action: CodeAction,
  normalizedTarget: string,
): TextEdit[] {
  const edit = action.edit;
  if (!edit) return [];

  if (edit.changes) {
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      if (normalizeUri(uri) === normalizedTarget) return textEdits;
    }
  }

  if (edit.documentChanges) {
    const result: TextEdit[] = [];
    for (const change of edit.documentChanges) {
      if ("textDocument" in change && "edits" in change) {
        if (normalizeUri(change.textDocument.uri) === normalizedTarget) {
          for (const e of change.edits) {
            // Skip annotated/snippet edits we can't represent as plain text.
            if ("range" in e && "newText" in e) result.push(e as TextEdit);
          }
        }
      }
    }
    return result;
  }

  return [];
}
