import { describe, expect, it } from "vitest";
import type {
  Diagnostic,
  ProtocolConnection,
} from "vscode-languageserver-protocol/node";
import {
  DiagnosticSeverity,
  PublishDiagnosticsNotification,
} from "vscode-languageserver-protocol/node";
import { TailwindLanguageClient } from "../../src/client.js";
import { createTailwindSettings } from "../../src/settings.js";
import { fileUri } from "../../src/uri.js";

/**
 * A stand-in `ProtocolConnection` that records outgoing notifications and lets
 * the test drive `publishDiagnostics` by hand. Only the members the client
 * touches during `open`/`validate` are implemented.
 */
function createFakeConnection() {
  let publish: ((params: unknown) => void) | undefined;
  const sent: { method: string; params: unknown }[] = [];
  const noopDisposable = { dispose() {} };

  const connection = {
    onRequest: () => noopDisposable,
    onNotification: (type: unknown, handler: (params: unknown) => void) => {
      if (type === PublishDiagnosticsNotification.type) publish = handler;
      return noopDisposable;
    },
    onError: () => noopDisposable,
    onClose: () => noopDisposable,
    sendNotification: (type: { method?: string }, params: unknown) => {
      sent.push({ method: type?.method ?? String(type), params });
      return Promise.resolve();
    },
  } as unknown as ProtocolConnection;

  return {
    connection,
    sent,
    /** Simulate a `publishDiagnostics` for `uri`. */
    publish(uri: string, diagnostics: Diagnostic[]) {
      publish?.({ uri, diagnostics });
    },
  };
}

function warning(message: string): Diagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
    severity: DiagnosticSeverity.Warning,
    message,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("TailwindLanguageClient publish correlation", () => {
  it("reads the open's publish, then re-validates on the fix's publish without picking up a stale one", async () => {
    const filePath = "/project/index.html";
    const uri = fileUri(filePath);
    const client = new TailwindLanguageClient({
      cwd: "/project",
      settings: createTailwindSettings(),
      documentTimeoutMs: 5_000,
    });
    const fake = createFakeConnection();
    client.attachConnectionForTesting(fake.connection);

    // `open` is notification #1; the server publishes once for it.
    await client.open({ filePath, languageId: "html", text: "before" });

    // The initial diagnostics come straight from that open publish.
    const initial = client.diagnostics(filePath);
    fake.publish(uri, [warning("open")]); // cumulative publish #1
    await expect(initial).resolves.toEqual({
      kind: "diagnostics",
      diagnostics: [warning("open")],
    });

    // Re-validation after a fix is notification #2, so it must wait for the
    // *second* cumulative publish (the fixed text). The open's publish (#1)
    // already counted must not resolve it early — that leak is what left a
    // stale `--fix` warning behind.
    const revalidated = client.validate(filePath, "after");
    let revalidatedSettled = false;
    void revalidated.then(() => {
      revalidatedSettled = true;
    });
    await tick();
    expect(revalidatedSettled).toBe(false);

    fake.publish(uri, []); // cumulative publish #2 — the fixed text
    await tick();
    expect(revalidatedSettled).toBe(true);
    await expect(revalidated).resolves.toEqual({
      kind: "diagnostics",
      diagnostics: [],
    });
  });
});
