import { URI } from "vscode-uri";

/** Normalizes any URI string to its canonical form. */
export function normalizeUri(uri: string): string {
  return URI.parse(uri).toString();
}

/** Builds a file:// URI string from an absolute filesystem path. */
export function fileUri(filePath: string): string {
  return URI.file(filePath).toString();
}
