import { describe, expect, it } from "vitest";
import {
  createTailwindSettings,
  parseRuleOverride,
} from "../../src/settings.js";

describe("parseRuleOverride", () => {
  it("parses a rule=severity pair", () => {
    expect(parseRuleOverride("cssConflict=error")).toEqual([
      "cssConflict",
      "error",
    ]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseRuleOverride("  cssConflict = warning ")).toEqual([
      "cssConflict",
      "warning",
    ]);
  });

  it("throws when the format is malformed", () => {
    expect(() => parseRuleOverride("cssConflict")).toThrow(
      /Invalid --severity value/,
    );
    expect(() => parseRuleOverride("=error")).toThrow(
      /Invalid --severity value/,
    );
    expect(() => parseRuleOverride("cssConflict=")).toThrow(
      /Invalid --severity value/,
    );
  });

  it("throws on an unknown rule name", () => {
    expect(() => parseRuleOverride("nope=error")).toThrow(
      /Unknown rule "nope"/,
    );
  });

  it("throws on an invalid severity", () => {
    expect(() => parseRuleOverride("cssConflict=fatal")).toThrow(
      /Invalid severity "fatal"/,
    );
  });
});

describe("createTailwindSettings", () => {
  it("uses default lint rules when no overrides are given", () => {
    const settings = createTailwindSettings();
    expect(settings.lint.cssConflict).toBe("warning");
    expect(settings.lint.invalidApply).toBe("error");
    expect(settings.experimental.configFile).toBeNull();
  });

  it("merges per-rule overrides over the defaults", () => {
    const settings = createTailwindSettings({
      rules: { cssConflict: "error" },
    });
    expect(settings.lint.cssConflict).toBe("error");
    // Untouched defaults remain.
    expect(settings.lint.invalidApply).toBe("error");
    expect(settings.lint.recommendedVariantOrder).toBe("warning");
  });

  it("provides default class attributes and functions", () => {
    const settings = createTailwindSettings();
    expect(settings.classAttributes).toContain("class");
    expect(settings.classAttributes).toContain("className");
    expect(settings.classFunctions).toContain("clsx");
  });

  it("honours overrides for attributes, functions and config file", () => {
    const settings = createTailwindSettings({
      classAttributes: ["class"],
      classFunctions: ["cn"],
      configFile: "tailwind.config.ts",
    });
    expect(settings.classAttributes).toEqual(["class"]);
    expect(settings.classFunctions).toEqual(["cn"]);
    expect(settings.experimental.configFile).toBe("tailwind.config.ts");
  });
});
