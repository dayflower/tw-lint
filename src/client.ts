import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  type ClientCapabilities,
  type CodeAction,
  CodeActionRequest,
  type Command,
  ConfigurationRequest,
  createProtocolConnection,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
  UnregistrationRequest,
} from "vscode-languageserver-protocol/node";
import { createEditorSettings, type TailwindCssSettings } from "./settings.js";
import { fileUri, normalizeUri } from "./uri.js";

const require = createRequire(import.meta.url);

const { version: CLIENT_VERSION } = require("../package.json") as {
  version: string;
};

function resolveServerEntry(): string {
  return require.resolve(
    "@tailwindcss/language-server/bin/tailwindcss-language-server",
  );
}

/** Outcome of a single document validation. */
export type ValidationResult =
  | { kind: "diagnostics"; diagnostics: Diagnostic[] }
  | { kind: "timeout" };

interface PublishWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

export interface DocumentInput {
  /** Absolute file path. */
  filePath: string;
  /** LSP language id. */
  languageId: string;
  /** Document text. */
  text: string;
}

export interface TailwindLanguageClientOptions {
  /** Workspace root (absolute path). */
  cwd: string;
  settings: TailwindCssSettings;
  /** Forward server stderr/log messages to stderr. */
  verbose?: boolean;
  /** Per-document revalidation timeout (ms). */
  documentTimeoutMs?: number;
  /** Timeout waiting for the first project to initialize (ms). */
  projectTimeoutMs?: number;
}

const CLIENT_CAPABILITIES: ClientCapabilities = {
  workspace: {
    configuration: true,
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true },
    workspaceFolders: true,
  },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: false },
    publishDiagnostics: { relatedInformation: true },
    codeAction: {
      dynamicRegistration: true,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ["quickfix", "source", "source.fixAll", ""],
        },
      },
      isPreferredSupport: true,
      resolveSupport: { properties: ["edit"] },
      dataSupport: true,
    },
  },
  // Opt into the `@/tailwindCSS/projectDetails` notification the server emits
  // once per discovered project. Combined with `@/tailwindCSS/serverReady`
  // (sent after the workspace scan completes) this lets us detect "no Tailwind
  // project" as soon as the scan finishes, instead of waiting for the project
  // initialization timeout.
  experimental: { tailwind: { projectDetails: true } },
};

/**
 * A minimal, headless LSP client that drives `@tailwindcss/language-server` to
 * obtain diagnostics and quick-fix code actions for documents. Project
 * detection (v3/v4), config loading and the actual validation are all performed
 * by the server, which uses `@tailwindcss/language-service` internally.
 *
 * Readiness handling: the server emits diagnostics asynchronously and the
 * `documentReady` notification it sends in test mode is not a reliable signal
 * (it can fire before the first diagnostics are published). Instead we open all
 * documents to trigger project initialization, wait for the
 * `@/tailwindCSS/projectInitialized` notification, and then force a fresh,
 * deterministic validation per document via `textDocument/didChange` — with the
 * test-mode debounce disabled, the matching `publishDiagnostics` arrives almost
 * immediately afterwards.
 */
export class TailwindLanguageClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private connection: ProtocolConnection | undefined;

  private readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly publishWaiters = new Map<string, PublishWaiter>();
  private readonly versions = new Map<string, number>();

  private projectInitialized = false;
  private projectResolve: (() => void) | undefined;
  private projectReject: ((error: Error) => void) | undefined;
  private projectGiveUp: (() => void) | undefined;

  /** True once the server has finished its initial workspace scan. */
  private serverReady = false;
  /** Number of Tailwind projects the server discovered during that scan. */
  private projectDetailsCount = 0;

  /** Set when the connection errors or closes unexpectedly. */
  private serverError: Error | undefined;
  /** True while dispose() is tearing down the connection on purpose. */
  private disposing = false;

  constructor(private readonly options: TailwindLanguageClientOptions) {}

  get hasDetectedProject(): boolean {
    return this.projectInitialized;
  }

  async start(): Promise<void> {
    const serverEntry = resolveServerEntry();
    const child = spawn(process.execPath, [serverEntry, "--stdio"], {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.child = child;

    child.stderr.on("data", (data: Buffer) => {
      if (this.options.verbose) process.stderr.write(data);
    });

    const connection = createProtocolConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    this.connection = connection;
    this.registerHandlers(connection);
    connection.listen();

    const rootUri = fileUri(this.options.cwd);
    await connection.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      clientInfo: { name: "tw-lint", version: CLIENT_VERSION },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: {
        // testMode disables the diagnostic debounce so a didChange is followed
        // almost immediately by publishDiagnostics, which we rely on below.
        testMode: true,
      },
    });
    await connection.sendNotification(InitializedNotification.type, {});
  }

  private registerHandlers(connection: ProtocolConnection): void {
    connection.onRequest(ConfigurationRequest.type, (params) =>
      params.items.map((item) => this.configurationFor(item.section)),
    );

    // The server dynamically registers/unregisters capabilities; acknowledge.
    connection.onRequest(RegistrationRequest.type, () => {});
    connection.onRequest(UnregistrationRequest.type, () => {});
    connection.onRequest("window/workDoneProgress/create", () => null);

    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      const key = normalizeUri(params.uri);
      this.diagnostics.set(key, params.diagnostics);
      const waiter = this.publishWaiters.get(key);
      if (waiter) {
        this.publishWaiters.delete(key);
        waiter.resolve();
      }
    });

    connection.onNotification("@/tailwindCSS/projectInitialized", () =>
      this.markProjectInitialized(),
    );
    connection.onNotification("@/tailwindCSS/projectReloaded", () =>
      this.markProjectInitialized(),
    );
    connection.onNotification("@/tailwindCSS/projectDetails", () => {
      this.projectDetailsCount += 1;
    });
    connection.onNotification("@/tailwindCSS/serverReady", () =>
      this.markServerReady(),
    );

    connection.onNotification(
      "window/logMessage",
      (params: { message?: string }) => {
        if (this.options.verbose && params?.message) {
          process.stderr.write(`[server] ${params.message}\n`);
        }
      },
    );
    connection.onNotification("window/showMessage", () => {});
    connection.onNotification("@/tailwindCSS/warn", () => {});

    connection.onError(([error]) =>
      this.handleServerError(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
    connection.onClose(() =>
      this.handleServerError(
        new Error("Language server connection closed unexpectedly"),
      ),
    );
  }

  /**
   * Records an unexpected connection failure and unblocks any pending waiters
   * by rejecting them, so callers see the failure instead of a silent empty
   * result. A close triggered by dispose() is expected and ignored.
   */
  private handleServerError(error: Error): void {
    if (this.disposing || this.serverError) return;
    this.serverError = error;
    for (const waiter of this.publishWaiters.values()) waiter.reject(error);
    this.publishWaiters.clear();
    this.projectReject?.(error);
  }

  private configurationFor(section: string | undefined): unknown {
    if (section === "tailwindCSS") return this.options.settings;
    if (section === "editor") return createEditorSettings();
    return {};
  }

  private markProjectInitialized(): void {
    this.projectInitialized = true;
    this.projectResolve?.();
  }

  /**
   * Records that the workspace scan finished. If it discovered no Tailwind
   * project, `projectInitialized` will never fire, so unblock any pending
   * `waitForProject` immediately instead of letting it time out.
   */
  private markServerReady(): void {
    this.serverReady = true;
    if (this.projectDetailsCount === 0) this.projectGiveUp?.();
  }

  private clearProjectWaiter(): void {
    this.projectResolve = undefined;
    this.projectReject = undefined;
    this.projectGiveUp = undefined;
  }

  /** Opens a document (version 1). Does not wait for diagnostics. */
  async open(doc: DocumentInput): Promise<void> {
    const connection = this.requireConnection();
    const uri = fileUri(doc.filePath);
    this.versions.set(uri, 1);
    await connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri,
        languageId: doc.languageId,
        version: 1,
        text: doc.text,
      },
    });
  }

  /**
   * Resolves once a Tailwind project has initialized, or after a timeout.
   * Rejects if the connection fails before a project is detected.
   */
  async waitForProject(): Promise<boolean> {
    if (this.serverError) throw this.serverError;
    if (this.projectInitialized) return true;
    // The scan already finished and found nothing: no project will initialize.
    if (this.serverReady && this.projectDetailsCount === 0) return false;
    const timeout = this.options.projectTimeoutMs ?? 20_000;
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.clearProjectWaiter();
        resolve(this.projectInitialized);
      }, timeout);
      this.projectResolve = () => {
        clearTimeout(timer);
        this.clearProjectWaiter();
        resolve(true);
      };
      this.projectReject = (error) => {
        clearTimeout(timer);
        this.clearProjectWaiter();
        reject(error);
      };
      this.projectGiveUp = () => {
        clearTimeout(timer);
        this.clearProjectWaiter();
        resolve(false);
      };
    });
  }

  /**
   * Forces a fresh validation of an already-opened document by sending a
   * `didChange` with the given text, and resolves with the resulting
   * diagnostics once they are published.
   */
  async validate(filePath: string, text: string): Promise<ValidationResult> {
    if (this.serverError) throw this.serverError;
    const connection = this.requireConnection();
    const uri = fileUri(filePath);
    const key = uri;
    const version = (this.versions.get(key) ?? 1) + 1;
    this.versions.set(key, version);

    const published = this.waitForNextPublish(key);
    await connection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
    const outcome = await published;
    if (outcome === "timeout") return { kind: "timeout" };
    return {
      kind: "diagnostics",
      diagnostics: this.diagnostics.get(key) ?? [],
    };
  }

  /**
   * Resolves with "published" when the matching diagnostics arrive, or
   * "timeout" if none do within the window. Rejects if the connection fails.
   */
  private waitForNextPublish(key: string): Promise<"published" | "timeout"> {
    const timeout = this.options.documentTimeoutMs ?? 15_000;
    return new Promise<"published" | "timeout">((resolve, reject) => {
      if (this.serverError) {
        reject(this.serverError);
        return;
      }
      const timer = setTimeout(() => {
        this.publishWaiters.delete(key);
        resolve("timeout");
      }, timeout);
      this.publishWaiters.set(key, {
        resolve: () => {
          clearTimeout(timer);
          resolve("published");
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  /** Requests quick-fix code actions for the given diagnostics. */
  async codeActions(
    filePath: string,
    text: string,
    diagnostics: Diagnostic[],
  ): Promise<(Command | CodeAction)[]> {
    if (diagnostics.length === 0) return [];
    const connection = this.requireConnection();
    const uri = fileUri(filePath);
    const result = await connection.sendRequest(CodeActionRequest.type, {
      textDocument: { uri },
      range: fullRange(text),
      context: { diagnostics },
    });
    return result ?? [];
  }

  private requireConnection(): ProtocolConnection {
    if (!this.connection) throw new Error("Client not started");
    return this.connection;
  }

  async dispose(): Promise<void> {
    this.disposing = true;
    const connection = this.connection;
    if (connection) {
      try {
        await connection.sendRequest(ShutdownRequest.type);
        await connection.sendNotification(ExitNotification.type);
      } catch {
        // ignore shutdown errors
      }
      connection.dispose();
    }
    if (this.child && !this.child.killed) this.child.kill();
    this.connection = undefined;
    this.child = undefined;
  }
}

function fullRange(text: string) {
  const lines = text.split("\n");
  const lastLine = lines.length - 1;
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lines[lastLine]?.length ?? 0 },
  };
}
