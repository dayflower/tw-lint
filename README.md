# tw-lint

An unofficial command-line linter for [Tailwind CSS](https://tailwindcss.com)
powered by the Tailwind CSS language tooling.

> [!NOTE]
> This is an **unofficial** project. It is not affiliated with, endorsed by, or
> sponsored by Tailwind Labs. "Tailwind CSS" is a trademark of Tailwind Labs Inc.

## Features

- Detects the problems surfaced by Tailwind CSS IntelliSense, including:
  `cssConflict`, `invalidApply`, `invalidScreen`, `invalidVariant`,
  `invalidConfigPath`, `invalidTailwindDirective`, `invalidSourceDirective`,
  `recommendedVariantOrder`, `usedBlocklistedClass`, `deprecatedAtRule`,
  `suggestCanonicalClasses`.
- Adjust each rule's severity (`ignore` / `warning` / `error`) via
  `--severity <rule=level>` or a config file.
- Works with both Tailwind CSS v3 (`tailwind.config.js`) and v4 (CSS-based config)
  projects — the version is auto-detected by the language server.
- Lints HTML, JSX/TSX, Vue, Svelte, Astro, PHP and other template languages,
  as well as CSS files.
- Human-readable text output and machine-readable `--format json`.
- `--fix` / `--fix-dry-run` apply the language server's quick-fixes.
- CI-friendly exit codes and `--max-warnings`.

## Requirements

- Node.js >= 22
- A Tailwind CSS project in the workspace:
  - **v3**: a `tailwind.config.{js,cjs,mjs,ts}` and `tailwindcss` installed in the
    project's `node_modules`.
  - **v4**: a CSS entrypoint that imports Tailwind (e.g. `@import "tailwindcss";`)
    and `tailwindcss` installed in the project's `node_modules`.

The language server loads the project's own `tailwindcss` (and its config) from
`node_modules` to compute diagnostics. This means **the target project's
dependencies must already be installed** before linting. In CI, run your install
step (e.g. `npm ci`) first:

```sh
npm ci
npx tw-lint "src/**/*.{tsx,html}"
```

If the dependencies are not installed, no Tailwind project is detected and the
linter reports no problems.

## Installation

```sh
npm install --save-dev @dayflower/tw-lint
```

## Usage

```sh
tw-lint [globs...] [options]
```

Examples:

```sh
# Lint everything (default globs) in the current project
tw-lint

# Lint specific files
tw-lint "src/**/*.{tsx,html}"

# Machine-readable output
tw-lint "src/**/*.tsx" --format json

# Treat class conflicts as errors
tw-lint --severity cssConflict=error

# Apply fixes
tw-lint "src/**/*.html" --fix
```

### Options

| Option | Description |
| --- | --- |
| `--cwd <dir>` | Project root directory (default: current directory). |
| `--format <text\|json>` | Output format (default: `text`). |
| `-c, --config <file>` | Path to a linter config file (see below). |
| `--severity <rule=level>` | Override a rule severity (`ignore`/`warning`/`error`). Repeatable. Overrides the config file. |
| `--tailwind-config <file>` | Force a specific Tailwind config file. |
| `--max-warnings <n>` | Exit non-zero if warnings exceed this number. |
| `--quiet` | Report errors only. |
| `--fix` | Apply fixes and write changes to files. |
| `--fix-dry-run` | Compute fixes without writing changes. |
| `--no-error-on-no-project` | Exit `0` instead of `2` when no Tailwind project is detected. |
| `--verbose` | Print language server logs to stderr. |

### Configuration file

Rule severities (and a few other settings) can be persisted in a config file so
they don't have to be passed on the command line every time. By default the
linter looks in the project root for, in order:

1. `tw-lint.config.json`
2. `.tw-lintrc.json`
3. a `"tw-lint"` key in `package.json`

Use `-c, --config <file>` to point at a specific file instead.

```jsonc
{
  // Rule severities: "ignore" | "warning" | "error"
  "rules": {
    "cssConflict": "error",
    "recommendedVariantOrder": "ignore"
  },
  // Attributes/functions whose string values are scanned for classes
  "classAttributes": ["class", "className", "tw"],
  "classFunctions": ["clsx", "cva", "cn"],
  // Map extra language ids to a known one (e.g. for custom templates)
  "includeLanguages": { "plaintext": "html" },
  // Equivalent to --tailwind-config
  "tailwindConfig": "./tailwind.config.ts"
}
```

> These rules are the *Tailwind CSS IntelliSense* lint settings
> (`tailwindCSS.lint.*`). They are **not** part of your `tailwind.config.js`,
> which only configures Tailwind's design system.

`--severity` overrides the config file on a per-rule basis, and
`--tailwind-config` overrides `tailwindConfig`.

#### Available rules

Every value is `"ignore"`, `"warning"` or `"error"`. The defaults match the
*Tailwind CSS IntelliSense* extension.

| Rule | Default | Description |
| --- | --- | --- |
| `invalidScreen` | `error` | Unknown screen name in a `@screen` directive. |
| `invalidVariant` | `error` | Unknown variant (e.g. `hvr:underline`). |
| `deprecatedAtRule` | `warning` | A deprecated at-rule is used (e.g. `@screen` in v4). |
| `invalidTailwindDirective` | `error` | Unknown value in a `@tailwind` directive. |
| `invalidApply` | `error` | A class used in `@apply` cannot be applied. |
| `invalidConfigPath` | `error` | A `theme()` / `config()` path that does not exist. |
| `cssConflict` | `warning` | Two classes on the same element apply the same CSS properties (e.g. `p-2 p-4`). |
| `recommendedVariantOrder` | `warning` | Stacked variants are not in the recommended order. |
| `usedBlocklistedClass` | `warning` | A class listed in the project's blocklist is used. |
| `suggestCanonicalClasses` | `warning` | Suggests the canonical class for an equivalent one. |
| `invalidSourceDirective` | `error` | Invalid `@source` directive (Tailwind v4). |

These are defined by the Tailwind CSS language service; the authoritative
descriptions are the `tailwindCSS.lint.*` settings in the
[Tailwind CSS IntelliSense extension settings](https://github.com/tailwindlabs/tailwindcss-intellisense#tailwindcssvalidate)
(the table above follows the same order). The rule names accepted here are the
keys under `tailwindCSS.lint`.

### Exit codes

- `0` — no errors (and warnings within `--max-warnings`, if set).
- `1` — errors found, or `--max-warnings` exceeded.
- `2` — the linter itself failed, or no Tailwind project was detected for the
  linted files (nothing was linted). Pass `--no-error-on-no-project` to treat
  the latter as `0` instead.

## Programmatic API

```ts
import { runLint, createTailwindSettings } from '@dayflower/tw-lint'

const summary = await runLint({
  cwd: process.cwd(),
  patterns: ['src/**/*.tsx'],
  settings: createTailwindSettings({ rules: { cssConflict: 'error' } }),
})

console.log(summary.errorCount, summary.warningCount)
```

## How it works

Instead of re-implementing lint rules, this tool drives
[`@tailwindcss/language-server`](https://www.npmjs.com/package/@tailwindcss/language-server)
as a headless [LSP](https://microsoft.github.io/language-server-protocol/) client.
The server performs project detection (Tailwind **v3** and **v4**), config loading
and validation using
[`@tailwindcss/language-service`](https://www.npmjs.com/package/@tailwindcss/language-service)
internally — the very same engine behind the *Tailwind CSS IntelliSense* editor
extension. This tool collects the resulting diagnostics, reports them on the
command line, and can apply the server's quick-fixes.

1. Spawns `tailwindcss-language-server --stdio` and connects over JSON-RPC.
2. Initializes the workspace and responds to the server's
   `workspace/configuration` requests with the lint settings.
3. Opens each matched document to trigger project initialization, waits for the
   project to initialize, then forces a fresh validation per document and
   collects the published diagnostics.
4. For `--fix`, requests `textDocument/codeAction` quick-fixes and applies the
   returned edits.

## License

[MIT](./LICENSE)
