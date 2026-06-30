/** Lint rule identifiers, matching the `tailwindCSS.lint.*` settings keys. */
export const RULES = [
  "cssConflict",
  "invalidApply",
  "invalidScreen",
  "invalidVariant",
  "deprecatedAtRule",
  "invalidConfigPath",
  "invalidTailwindDirective",
  "invalidSourceDirective",
  "recommendedVariantOrder",
  "usedBlocklistedClass",
  "suggestCanonicalClasses",
] as const;

export type RuleName = (typeof RULES)[number];

/** Severity level for a lint rule, matching the language server's setting values. */
export type RuleSeverity = "ignore" | "warning" | "error";

/** Severity of an emitted message (after rule filtering). */
export type MessageSeverity = "error" | "warning";

export interface LintMessage {
  /** The diagnostic rule that produced this message, or null if unknown. */
  rule: string | null;
  severity: MessageSeverity;
  message: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** 1-based end line number. */
  endLine: number;
  /** 1-based end column number. */
  endColumn: number;
}

export interface LintResult {
  /** Absolute path of the linted file. */
  filePath: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
  /** Number of fixes applied to this file (only set when running with fix). */
  fixCount?: number;
  /** Source text after fixes were applied (only set when running with fix). */
  output?: string;
}

export interface LintSummary {
  results: LintResult[];
  errorCount: number;
  warningCount: number;
  fixCount: number;
  /** True when no Tailwind project could be detected for the linted files. */
  noProjectDetected: boolean;
}
