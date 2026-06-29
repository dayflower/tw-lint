import path from 'node:path'
import process from 'node:process'
import { cac } from 'cac'
import { loadLinterConfig } from './config.js'
import { runLint, type FixMode } from './lint.js'
import { formatJson, formatText } from './reporter.js'
import { createTailwindSettings, parseRuleOverride } from './settings.js'
import type { RuleName, RuleSeverity } from './types.js'

interface CliOptions {
  cwd?: string
  format?: string
  severity?: string | string[]
  config?: string
  tailwindConfig?: string
  maxWarnings?: string | number
  quiet?: boolean
  fix?: boolean
  fixDryRun?: boolean
  verbose?: boolean
}

function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

async function main(): Promise<number> {
  const cli = cac('tw-lint')

  cli
    .command('[...globs]', 'Lint files for Tailwind CSS problems')
    .option('--cwd <dir>', 'Project root directory', { default: process.cwd() })
    .option('--format <format>', 'Output format: text | json', { default: 'text' })
    .option('-c, --config <file>', 'Path to a linter config file (JSON)')
    .option('--severity <rule=level>', 'Override a rule severity (repeatable)')
    .option('--tailwind-config <file>', 'Force a specific Tailwind config file')
    .option('--max-warnings <n>', 'Number of warnings to trigger a non-zero exit code')
    .option('--quiet', 'Report errors only')
    .option('--fix', 'Automatically fix problems and write changes to files')
    .option('--fix-dry-run', 'Compute fixes without writing changes to files')
    .option('--verbose', 'Print language server diagnostics to stderr')

  cli.help()

  const parsed = cli.parse(process.argv, { run: false })

  if (parsed.options.help) {
    return 0
  }

  const globs = parsed.args as string[]
  const options = parsed.options as CliOptions

  const format = options.format === 'json' ? 'json' : 'text'
  const cwd = path.resolve(options.cwd ?? process.cwd())

  // Config file provides the base; CLI flags override it.
  const { overrides } = await loadLinterConfig(cwd, options.config)

  const cliRules: Partial<Record<RuleName, RuleSeverity>> = {}
  for (const entry of asArray(options.severity)) {
    const [rule, severity] = parseRuleOverride(entry)
    cliRules[rule] = severity
  }
  overrides.rules = { ...overrides.rules, ...cliRules }

  if (options.tailwindConfig) overrides.configFile = options.tailwindConfig

  const settings = createTailwindSettings(overrides)

  const fix: FixMode = options.fixDryRun ? 'dry-run' : options.fix ? 'apply' : 'none'

  const summary = await runLint({
    cwd,
    patterns: globs,
    settings,
    fix,
    verbose: options.verbose,
  })

  if (options.quiet) {
    for (const result of summary.results) {
      result.messages = result.messages.filter((m) => m.severity === 'error')
      result.warningCount = 0
    }
    summary.warningCount = 0
  }

  if (format === 'json') {
    process.stdout.write(formatJson(summary) + '\n')
  } else {
    const text = formatText(summary, cwd)
    if (text.trim().length > 0) {
      process.stdout.write(text + '\n')
    }
  }

  return resolveExitCode(summary.errorCount, summary.warningCount, options.maxWarnings)
}

function resolveExitCode(
  errorCount: number,
  warningCount: number,
  maxWarnings: string | number | undefined,
): number {
  if (errorCount > 0) return 1
  if (maxWarnings !== undefined) {
    const limit = Number(maxWarnings)
    if (Number.isFinite(limit) && warningCount > limit) return 1
  }
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`tw-lint: ${message}\n`)
    process.exitCode = 2
  })
