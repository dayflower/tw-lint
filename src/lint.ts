import { readFile, writeFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import type {
  CodeAction,
  Command,
  Diagnostic,
} from "vscode-languageserver-protocol/node";
import { TailwindLanguageClient, type ValidationResult } from "./client.js";
import { applyTextEdits, collectFixEdits } from "./fix.js";
import {
  DEFAULT_GLOBS,
  DEFAULT_IGNORE,
  languageIdForFile,
} from "./languages.js";
import { summarize, toLintMessages } from "./reporter.js";
import type { TailwindCssSettings } from "./settings.js";
import type { LintResult, LintSummary } from "./types.js";
import { fileUri } from "./uri.js";

export type FixMode = "none" | "apply" | "dry-run";

/** A file selected for linting, with its resolved LSP language id. */
export interface TargetFile {
  filePath: string;
  languageId: string;
}

/**
 * The subset of the language client that per-document linting depends on.
 * Declaring it as an interface lets `lintDocument` run against a mock client
 * without spawning the real language server.
 */
export interface LintClient {
  validate(filePath: string, text: string): Promise<ValidationResult>;
  codeActions(
    filePath: string,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<(Command | CodeAction)[]>;
}

export interface RunLintOptions {
  /** Workspace root (absolute path). */
  cwd: string;
  /** Glob patterns to lint. Defaults to common Tailwind file types. */
  patterns?: string[];
  /** Additional ignore globs. */
  ignore?: string[];
  settings: TailwindCssSettings;
  fix?: FixMode;
  verbose?: boolean;
  documentTimeoutMs?: number;
  /** Timeout waiting for the first Tailwind project to initialize (ms). */
  projectTimeoutMs?: number;
}

/**
 * Discovers lintable files: globs `patterns` under `cwd`, keeps only those with
 * a known language id, and returns them sorted by path. `ignore` is passed to
 * the globber verbatim (callers compose it with the defaults).
 */
export async function collectTargetFiles(
  cwd: string,
  patterns: string[],
  ignore: string[],
): Promise<TargetFile[]> {
  const matched = await glob(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore,
  });

  return matched
    .map((filePath) => ({ filePath, languageId: languageIdForFile(filePath) }))
    .filter((entry): entry is TargetFile => Boolean(entry.languageId))
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/**
 * Lints a single, already-opened document: validates it, optionally requests
 * and applies quick-fixes, then re-validates the fixed text. Returns the result
 * without touching the filesystem — when `fixMode` is "apply" the caller writes
 * `output` back to disk. Re-validation runs against the in-memory fixed text,
 * so it is independent of any such write.
 */
export async function lintDocument(
  client: LintClient,
  source: { filePath: string; text: string },
  fixMode: FixMode,
): Promise<LintResult> {
  const { filePath, text } = source;
  let timedOut = false;
  const initial = await client.validate(filePath, text);
  let diagnostics = initial.kind === "timeout" ? [] : initial.diagnostics;
  if (initial.kind === "timeout") timedOut = true;
  let fixCount = 0;
  let output: string | undefined;

  if (fixMode !== "none") {
    const actions = await client.codeActions(filePath, text, diagnostics);
    const edits = collectFixEdits(actions, fileUri(filePath));
    if (edits.length > 0) {
      const fixed = applyTextEdits(text, edits);
      if (fixed !== text) {
        fixCount = edits.length;
        output = fixed;
        // Re-lint the fixed content so remaining problems are reported.
        const revalidated = await client.validate(filePath, fixed);
        if (revalidated.kind === "timeout") {
          timedOut = true;
          diagnostics = [];
        } else {
          diagnostics = revalidated.diagnostics;
        }
      }
    }
  }

  const messages = toLintMessages(diagnostics);
  return {
    filePath,
    messages,
    errorCount: messages.filter((m) => m.severity === "error").length,
    warningCount: messages.filter((m) => m.severity === "warning").length,
    ...(fixCount > 0 ? { fixCount } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  };
}

export async function runLint(options: RunLintOptions): Promise<LintSummary> {
  const { cwd, settings } = options;
  const fix = options.fix ?? "none";
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_GLOBS;
  const ignore = [...DEFAULT_IGNORE, ...(options.ignore ?? [])];

  const files = await collectTargetFiles(cwd, patterns, ignore);

  if (files.length === 0) {
    return summarize([], false);
  }

  const client = new TailwindLanguageClient({
    cwd,
    settings,
    verbose: options.verbose,
    documentTimeoutMs: options.documentTimeoutMs,
    projectTimeoutMs: options.projectTimeoutMs,
  });

  const sources = new Map<string, { languageId: string; text: string }>();
  const results: LintResult[] = [];

  try {
    await client.start();

    // Phase 1: open every document so the server discovers and initializes the
    // relevant Tailwind project(s).
    for (const { filePath, languageId } of files) {
      const text = await readFile(filePath, "utf8");
      sources.set(filePath, { languageId, text });
      await client.open({ filePath, languageId, text });
    }

    const projectDetected = await client.waitForProject();

    // Without a detected project the server never validates the documents, so
    // skip the (otherwise timing-out) validation phase and report no problems.
    if (!projectDetected) {
      for (const { filePath } of files) {
        results.push({
          filePath,
          messages: [],
          errorCount: 0,
          warningCount: 0,
        });
      }
      return summarize(results, true);
    }

    // Phase 2: force a fresh validation per document and collect diagnostics.
    for (const { filePath } of files) {
      const source = sources.get(filePath);
      if (!source) continue;
      const result = await lintDocument(
        client,
        { filePath, text: source.text },
        fix,
      );
      if (fix === "apply" && result.output !== undefined) {
        await writeFile(filePath, result.output, "utf8");
      }
      results.push(result);
    }

    return summarize(results, false);
  } finally {
    await client.dispose();
  }
}
