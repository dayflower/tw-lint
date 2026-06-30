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

/** Accepted severity values, in the order used by error messages. */
export const RULE_SEVERITIES = ["ignore", "warning", "error"] as const;

/** Type guard for a valid rule name. */
export function isRuleName(value: unknown): value is RuleName {
  return (
    typeof value === "string" && (RULES as readonly string[]).includes(value)
  );
}

/** Type guard for a valid rule severity. */
export function isRuleSeverity(value: unknown): value is RuleSeverity {
  return (
    typeof value === "string" &&
    (RULE_SEVERITIES as readonly string[]).includes(value)
  );
}

/** Builds the standard "unknown rule" error message. `at` names the source. */
export function unknownRuleMessage(rule: string, at?: string): string {
  const where = at ? ` in ${at}` : "";
  return `Unknown rule "${rule}"${where}. Known rules: ${RULES.join(", ")}.`;
}

/** Builds the standard "invalid severity" error message. `at` names the source. */
export function invalidSeverityMessage(
  rule: string,
  severity: unknown,
  at?: string,
): string {
  const where = at ? ` in ${at}` : "";
  return (
    `Invalid severity "${String(severity)}" for rule "${rule}"${where}. ` +
    `Expected ${RULE_SEVERITIES.join("|")}.`
  );
}

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
