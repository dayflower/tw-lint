import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLinterConfig } from "../../src/config.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tw-lint-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(name: string, value: unknown): void {
  writeFileSync(path.join(dir, name), JSON.stringify(value));
}

describe("loadLinterConfig", () => {
  it("returns empty overrides when no config exists", async () => {
    const { overrides, source } = await loadLinterConfig(dir);
    expect(overrides).toEqual({});
    expect(source).toBeUndefined();
  });

  it("loads rules and other fields from a config file", async () => {
    writeConfig("tw-lint.config.json", {
      rules: { cssConflict: "error" },
      classAttributes: ["class"],
      tailwindConfig: "tailwind.config.ts",
    });
    const { overrides, source } = await loadLinterConfig(dir);
    expect(source).toBe(path.join(dir, "tw-lint.config.json"));
    expect(overrides.rules).toEqual({ cssConflict: "error" });
    expect(overrides.classAttributes).toEqual(["class"]);
    expect(overrides.configFile).toBe("tailwind.config.ts");
  });

  it("falls back to the package.json key", async () => {
    writeConfig("package.json", {
      name: "demo",
      "tw-lint": { rules: { cssConflict: "warning" } },
    });
    const { overrides, source } = await loadLinterConfig(dir);
    expect(source).toBe(path.join(dir, "package.json"));
    expect(overrides.rules).toEqual({ cssConflict: "warning" });
  });

  it("throws when the package.json key is not an object", async () => {
    writeConfig("package.json", { "tw-lint": "nope" });
    await expect(loadLinterConfig(dir)).rejects.toThrow(/must be an object/);
  });

  it("rejects an unknown rule name", async () => {
    writeConfig("tw-lint.config.json", { rules: { nope: "error" } });
    await expect(loadLinterConfig(dir)).rejects.toThrow(/Unknown rule "nope"/);
  });

  it("rejects an invalid severity", async () => {
    writeConfig("tw-lint.config.json", { rules: { cssConflict: "fatal" } });
    await expect(loadLinterConfig(dir)).rejects.toThrow(
      /Invalid severity "fatal"/,
    );
  });

  it("rejects a non-object rules value", async () => {
    writeConfig("tw-lint.config.json", { rules: ["cssConflict"] });
    await expect(loadLinterConfig(dir)).rejects.toThrow(
      /"rules" .* must be an object/,
    );
  });

  it("rejects classAttributes that is not a string array", async () => {
    writeConfig("tw-lint.config.json", { classAttributes: [1, 2] });
    await expect(loadLinterConfig(dir)).rejects.toThrow(
      /"classAttributes" .* must be an array of strings/,
    );
  });

  it("rejects a non-string tailwindConfig", async () => {
    writeConfig("tw-lint.config.json", { tailwindConfig: 123 });
    await expect(loadLinterConfig(dir)).rejects.toThrow(
      /"tailwindConfig" .* must be a string/,
    );
  });

  it("throws when an explicit config path does not exist", async () => {
    await expect(loadLinterConfig(dir, "missing.config.json")).rejects.toThrow(
      /Config file not found/,
    );
  });
});
