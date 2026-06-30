import { describe, expect, it } from "vitest";
import { URI } from "vscode-uri";
import { fileUri, normalizeUri } from "../../src/uri.js";

describe("fileUri", () => {
  it("builds a file:// URI from an absolute path", () => {
    expect(fileUri("/project/index.html")).toBe(
      URI.file("/project/index.html").toString(),
    );
    expect(fileUri("/project/index.html").startsWith("file://")).toBe(true);
  });
});

describe("normalizeUri", () => {
  it("is idempotent on an already-canonical URI", () => {
    const canonical = fileUri("/project/index.html");
    expect(normalizeUri(canonical)).toBe(canonical);
  });

  it("canonicalizes an unnormalized URI", () => {
    const canonical = fileUri("/project/index.html");
    expect(normalizeUri("file:///project/index.html")).toBe(canonical);
  });
});
