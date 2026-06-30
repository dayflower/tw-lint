import { readFile, writeFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import { TailwindLanguageClient } from "./client.js";
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

export async function runLint(options: RunLintOptions): Promise<LintSummary> {
  const { cwd, settings } = options;
  const fix = options.fix ?? "none";
  const patterns = options.patterns?.length ? options.patterns : DEFAULT_GLOBS;

  const matched = await glob(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: [...DEFAULT_IGNORE, ...(options.ignore ?? [])],
  });

  const files = matched
    .map((filePath) => ({ filePath, languageId: languageIdForFile(filePath) }))
    .filter((entry): entry is { filePath: string; languageId: string } =>
      Boolean(entry.languageId),
    )
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

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
      let diagnostics = await client.validate(filePath, source.text);
      let fixCount = 0;
      let output: string | undefined;

      if (fix !== "none") {
        const actions = await client.codeActions(
          filePath,
          source.text,
          diagnostics,
        );
        const edits = collectFixEdits(actions, fileUri(filePath));
        if (edits.length > 0) {
          const fixed = applyTextEdits(source.text, edits);
          if (fixed !== source.text) {
            fixCount = edits.length;
            output = fixed;
            if (fix === "apply") {
              await writeFile(filePath, fixed, "utf8");
            }
            // Re-lint the fixed content so remaining problems are reported.
            diagnostics = await client.validate(filePath, fixed);
          }
        }
      }

      const messages = toLintMessages(diagnostics);
      results.push({
        filePath,
        messages,
        errorCount: messages.filter((m) => m.severity === "error").length,
        warningCount: messages.filter((m) => m.severity === "warning").length,
        ...(fixCount > 0 ? { fixCount } : {}),
        ...(output !== undefined ? { output } : {}),
      });
    }

    return summarize(results, !projectDetected);
  } finally {
    await client.dispose();
  }
}
