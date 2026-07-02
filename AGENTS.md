# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

`@dayflower/tw-lint` is a command-line linter for Tailwind CSS. It
does **not** implement lint rules itself. Instead it drives
[`@tailwindcss/language-server`](https://www.npmjs.com/package/@tailwindcss/language-server)
as a headless LSP client over JSON-RPC, collects the diagnostics the server
publishes, reports them on the CLI, and can apply the server's quick-fixes. The
same engine powers the *Tailwind CSS IntelliSense* editor extension, so the lint
rules and their default severities mirror its `tailwindCSS.lint.*` settings.

It is an ESM-only TypeScript package targeting Node.js >= 22. The CLI is exposed
as `tw-lint`, and the same engine is also shipped as a reusable GitHub Action
(see "GitHub Action" below).

## Commands

```sh
npm run build       # bundle with tsdown -> dist/ (cli.js, index.js, *.d.ts)
npm run build:action # bundle the GitHub Action -> action/ + vendored server
npm run dev         # run the CLI from source via tsx (src/cli.ts)
npm run typecheck   # tsc --noEmit
npm run check       # biome check . (lint + format + import sort, no writes)
npm run fix         # biome check --write . (apply safe fixes)
npm test            # vitest run (pretest installs the test fixtures' deps)
npm run test:watch  # vitest in watch mode
```

`npm test` runs `pretest` first, which installs the `tailwindcss` dependencies
inside `test/fixtures/v3` and `test/fixtures/v4`. The language server loads each
target project's own `tailwindcss` from its `node_modules`, so those fixtures
must have dependencies installed for the tests (and for any manual linting) to
detect a Tailwind project.

## Source layout (`src/`)

- `cli.ts` — CLI entry point (argument parsing with `cac`, exit codes).
- `action.ts` — GitHub Action entry point (`@actions/core` inputs/outputs).
- `run.ts` — `runCli`, the shared orchestration (runLint + exit-code + operational
  failures) reused by both `cli.ts` and `action.ts`.
- `index.ts` — public programmatic API (re-exports).
- `lint.ts` — `runLint` orchestration: glob, open documents, collect diagnostics.
- `client.ts` — `TailwindLanguageClient`, the headless LSP client wrapper. The
  language server binary is resolved via `require.resolve`, overridable with the
  `TW_LINT_LANGUAGE_SERVER_ENTRY` env var (the Action points it at its vendored
  copy).
- `settings.ts` — builds the language server's editor/lint settings.
- `config.ts` — loads the linter config file (`tw-lint.config.json`,
  `.tw-lintrc.json`, or the `tw-lint` key in `package.json`).
- `fix.ts` — requests code actions and applies text edits for `--fix`.
- `reporter.ts` — text, JSON, and GitHub (`::error::`/`::warning::`) output,
  plus summary helpers.
- `languages.ts` — default globs/ignores and file-extension → language-id mapping.
- `types.ts` — `RULES` list, severity types, `LintMessage`/`LintResult` shapes.

## Conventions

- ESM only. Use explicit `.js` extensions in relative imports (e.g.
  `import { runLint } from './lint.js'`), matching the existing code.
- Keep all code, comments, and docs in English.
- Rule names are exactly the `tailwindCSS.lint.*` keys; the canonical list lives
  in `RULES` in `src/types.ts`. Keep `README.md`'s rules table and any severity
  defaults in sync with the language service.
- Build is bundled by `tsdown` (see `tsdown.config.ts`); the published package
  ships only `dist/`.
- Linting and formatting are handled by [Biome](https://biomejs.dev/) (see
  `biome.json`): double quotes and semicolons. Run `npm run fix` before
  committing, and `npm run check` must pass. The intentionally-malformed
  `test/fixtures/**/*.html` are excluded from Biome.

## GitHub Action

The repo doubles as a reusable GitHub Action (`uses: dayflower/tw-lint@v1`).

- `action.yml` (repo root) is a `runs.using: node24` action whose `main` points at
  the committed bundle `action/index.mjs`. Its inputs map 1:1 to CLI options; keep
  the two in sync (and mirror any changes in `README.md`'s inputs table).
- `npm run build:action` uses `tsdown.action.config.ts` to bundle `src/action.ts`
  into `action/index.mjs` (keeping `@tailwindcss/language-server` external), then
  `scripts/vendor-language-server.mjs` copies the self-contained (zero-dependency)
  language server into `action/vendor/`.
- `action/` is **git-ignored**. It is generated at release time and force-added
  into the release tag by `.github/workflows/release.yml`, which also moves the
  floating `v<major>` tag. Do not commit `action/` on normal branches.
- The Action reuses `runCli` and `formatGithub`; do not duplicate exit-code or
  annotation logic in `action.ts`.

## Testing notes

- Tests live in `test/lint.test.ts` and run against the fixtures in
  `test/fixtures/{none,v3,v4}`.
- Each test spawns its own language server, which needs a few seconds to detect
  and build a project. `vitest.config.ts` sets a 60s timeout and disables file
  parallelism — do not assume tests are fast or concurrent.

## Git / PR conventions

- Conventional Commits, but without a scope in parentheses (use `feat:`, not
  `feat(cli):`). Keep the title to a single line.
- Commit messages and PR descriptions are written in English.
