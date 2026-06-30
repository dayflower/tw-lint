import path from "node:path";

/**
 * Maps file extensions to the LSP `languageId` the Tailwind language server
 * understands. The server extracts class names based on the language id, so an
 * accurate mapping is required for diagnostics to run.
 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  ".html": "html",
  ".htm": "html",
  ".xhtml": "html",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascriptreact",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".css": "css",
  ".pcss": "css",
  ".postcss": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".php": "php",
  ".twig": "twig",
  ".erb": "erb",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".md": "markdown",
  ".mdx": "mdx",
};

/** Default glob patterns used when the user does not pass any. */
export const DEFAULT_GLOBS = [
  "**/*.{html,htm,vue,svelte,astro,js,cjs,mjs,jsx,ts,mts,cts,tsx,css,pcss,postcss,scss,sass,less,php,twig,erb,hbs,handlebars,md,mdx}",
];

/** Globs that are always ignored. */
export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
];

/** Returns the LSP languageId for a file, or `undefined` if unsupported. */
export function languageIdForFile(filePath: string): string | undefined {
  return EXT_TO_LANGUAGE[path.extname(filePath).toLowerCase()];
}
