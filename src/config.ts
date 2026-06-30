import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SettingsOverrides } from "./settings.js";
import { RULES, type RuleName, type RuleSeverity } from "./types.js";

/** Config file names searched (in order) when `--config` is not given. */
export const DEFAULT_CONFIG_FILES = ["tw-lint.config.json", ".tw-lintrc.json"];

/** Key read from `package.json` as a fallback config source. */
export const PACKAGE_JSON_KEY = "tw-lint";

export interface LoadedConfig {
  overrides: SettingsOverrides;
  /** Absolute path of the config source, or undefined when none was found. */
  source?: string;
}

interface RawConfig {
  rules?: unknown;
  classAttributes?: unknown;
  classFunctions?: unknown;
  includeLanguages?: unknown;
  tailwindConfig?: unknown;
}

/**
 * Loads linter settings from a config file. When `explicitPath` is given it must
 * exist; otherwise the default file names (and a `package.json` key) are tried in
 * the workspace root. Returns empty overrides when nothing is found.
 */
export async function loadLinterConfig(
  cwd: string,
  explicitPath?: string,
): Promise<LoadedConfig> {
  const found = await resolveConfigSource(cwd, explicitPath);
  if (!found) return { overrides: {} };
  return {
    overrides: parseConfig(found.raw, found.source),
    source: found.source,
  };
}

async function resolveConfigSource(
  cwd: string,
  explicitPath?: string,
): Promise<{ source: string; raw: RawConfig } | undefined> {
  if (explicitPath) {
    const source = path.resolve(cwd, explicitPath);
    if (!existsSync(source)) {
      throw new Error(`Config file not found: ${source}`);
    }
    return { source, raw: await readJson(source) };
  }

  for (const name of DEFAULT_CONFIG_FILES) {
    const source = path.join(cwd, name);
    if (existsSync(source)) {
      return { source, raw: await readJson(source) };
    }
  }

  const pkgPath = path.join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = await readJson(pkgPath);
    const value = (pkg as Record<string, unknown>)[PACKAGE_JSON_KEY];
    if (value !== undefined) {
      if (!isObject(value)) {
        throw new Error(
          `"${PACKAGE_JSON_KEY}" in ${pkgPath} must be an object.`,
        );
      }
      return { source: pkgPath, raw: value as RawConfig };
    }
  }

  return undefined;
}

async function readJson(file: string): Promise<RawConfig> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read config file ${file}: ${(error as Error).message}`,
    );
  }
  try {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as RawConfig;
  } catch (error) {
    throw new Error(`Invalid config file ${file}: ${(error as Error).message}`);
  }
}

function parseConfig(raw: RawConfig, source: string): SettingsOverrides {
  const overrides: SettingsOverrides = {};

  if (raw.rules !== undefined) {
    overrides.rules = parseRules(raw.rules, source);
  }
  if (raw.classAttributes !== undefined) {
    overrides.classAttributes = parseStringArray(
      raw.classAttributes,
      "classAttributes",
      source,
    );
  }
  if (raw.classFunctions !== undefined) {
    overrides.classFunctions = parseStringArray(
      raw.classFunctions,
      "classFunctions",
      source,
    );
  }
  if (raw.includeLanguages !== undefined) {
    overrides.includeLanguages = parseStringRecord(
      raw.includeLanguages,
      "includeLanguages",
      source,
    );
  }
  if (raw.tailwindConfig !== undefined) {
    if (typeof raw.tailwindConfig !== "string") {
      throw new Error(`"tailwindConfig" in ${source} must be a string.`);
    }
    overrides.configFile = raw.tailwindConfig;
  }

  return overrides;
}

function parseRules(
  value: unknown,
  source: string,
): Partial<Record<RuleName, RuleSeverity>> {
  if (!isObject(value)) {
    throw new Error(`"rules" in ${source} must be an object.`);
  }
  const result: Partial<Record<RuleName, RuleSeverity>> = {};
  for (const [rule, severity] of Object.entries(value)) {
    if (!(RULES as readonly string[]).includes(rule)) {
      throw new Error(
        `Unknown rule "${rule}" in ${source}. Known rules: ${RULES.join(", ")}.`,
      );
    }
    if (
      severity !== "ignore" &&
      severity !== "warning" &&
      severity !== "error"
    ) {
      throw new Error(
        `Invalid severity "${String(severity)}" for rule "${rule}" in ${source}. ` +
          "Expected ignore|warning|error.",
      );
    }
    result[rule as RuleName] = severity;
  }
  return result;
}

function parseStringArray(
  value: unknown,
  field: string,
  source: string,
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`"${field}" in ${source} must be an array of strings.`);
  }
  return value as string[];
}

function parseStringRecord(
  value: unknown,
  field: string,
  source: string,
): Record<string, string> {
  if (
    !isObject(value) ||
    Object.values(value).some((item) => typeof item !== "string")
  ) {
    throw new Error(
      `"${field}" in ${source} must be an object mapping strings to strings.`,
    );
  }
  return value as Record<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
