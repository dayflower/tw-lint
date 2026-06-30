import { COMMON_IGNORE } from "./languages.js";
import {
  invalidSeverityMessage,
  isRuleName,
  isRuleSeverity,
  type RuleName,
  type RuleSeverity,
  unknownRuleMessage,
} from "./types.js";

/** Subset of `tailwindCSS.*` settings relevant to linting. */
export interface TailwindCssSettings {
  validate: boolean;
  lint: Record<RuleName, RuleSeverity>;
  includeLanguages: Record<string, string>;
  classAttributes: string[];
  classFunctions: string[];
  experimental: {
    classRegex: string[] | [string, string][];
    configFile: string | Record<string, string | string[]> | null;
  };
  files: {
    exclude: string[];
  };
}

/**
 * Default lint severities. These mirror the defaults shipped by the official
 * Tailwind CSS IntelliSense extension so behaviour matches a typical editor.
 */
function defaultLintRules(): Record<RuleName, RuleSeverity> {
  return {
    cssConflict: "warning",
    invalidApply: "error",
    invalidScreen: "error",
    invalidVariant: "error",
    deprecatedAtRule: "warning",
    invalidConfigPath: "error",
    invalidTailwindDirective: "error",
    invalidSourceDirective: "error",
    recommendedVariantOrder: "warning",
    usedBlocklistedClass: "warning",
    suggestCanonicalClasses: "warning",
  };
}

export interface SettingsOverrides {
  /** Per-rule severity overrides. */
  rules?: Partial<Record<RuleName, RuleSeverity>>;
  /** Additional language id remapping (e.g. `{ plaintext: 'html' }`). */
  includeLanguages?: Record<string, string>;
  classAttributes?: string[];
  classFunctions?: string[];
  /** Force a specific config file (maps to `tailwindCSS.experimental.configFile`). */
  configFile?: string | Record<string, string | string[]> | null;
}

export function createTailwindSettings(
  overrides: SettingsOverrides = {},
): TailwindCssSettings {
  return {
    validate: true,
    lint: { ...defaultLintRules(), ...overrides.rules },
    includeLanguages: { ...overrides.includeLanguages },
    classAttributes: overrides.classAttributes ?? [
      "class",
      "className",
      "ngClass",
      "class:list",
    ],
    classFunctions: overrides.classFunctions ?? [
      "clsx",
      "cva",
      "cn",
      "tw",
      "twMerge",
      "twJoin",
    ],
    experimental: {
      classRegex: [],
      configFile: overrides.configFile ?? null,
    },
    files: {
      // Paths the language server skips while scanning the workspace.
      exclude: [...COMMON_IGNORE, "**/.hg/**", "**/.svn/**"],
    },
  };
}

/** Minimal `editor` settings the server may request. */
export function createEditorSettings(): Record<string, unknown> {
  return {
    tabSize: 2,
  };
}

/** Parses a `rule=severity` CLI override string into a rule entry. */
export function parseRuleOverride(input: string): [RuleName, RuleSeverity] {
  const [rawRule, rawSeverity] = input.split("=");
  const rule = rawRule?.trim();
  const severity = rawSeverity?.trim();

  if (!rule || !severity) {
    throw new Error(
      `Invalid --severity value "${input}". Expected "rule=ignore|warning|error".`,
    );
  }
  if (!isRuleName(rule)) {
    throw new Error(unknownRuleMessage(rule));
  }
  if (!isRuleSeverity(severity)) {
    throw new Error(invalidSeverityMessage(rule, severity));
  }
  return [rule, severity];
}
