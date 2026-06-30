import { describe, expect, it } from "vitest";
import { languageIdForFile } from "../../src/languages.js";

describe("languageIdForFile", () => {
  it("maps common extensions to language ids", () => {
    expect(languageIdForFile("index.html")).toBe("html");
    expect(languageIdForFile("App.vue")).toBe("vue");
    expect(languageIdForFile("Component.tsx")).toBe("typescriptreact");
    expect(languageIdForFile("styles.css")).toBe("css");
    expect(languageIdForFile("page.md")).toBe("markdown");
  });

  it("ignores extension casing", () => {
    expect(languageIdForFile("INDEX.HTML")).toBe("html");
    expect(languageIdForFile("App.TS")).toBe("typescript");
  });

  it("resolves by extension regardless of directory", () => {
    expect(languageIdForFile("/abs/path/to/file.jsx")).toBe("javascriptreact");
  });

  it("returns undefined for unsupported extensions", () => {
    expect(languageIdForFile("archive.zip")).toBeUndefined();
    expect(languageIdForFile("Makefile")).toBeUndefined();
  });
});
