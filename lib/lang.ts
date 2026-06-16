// Extension → Monaco language id, plus source-file classification for the graph.

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "shell", bash: "shell", zsh: "shell",
  yml: "yaml", yaml: "yaml",
  json: "json", jsonc: "json",
  md: "markdown", markdown: "markdown",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  sql: "sql",
  toml: "ini", ini: "ini", cfg: "ini",
  xml: "xml",
  vue: "html",
  svelte: "html",
  lua: "lua",
  r: "r",
  dart: "dart",
};

const SPECIAL_NAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  ".gitignore": "ignore",
  ".env": "ini",
};

export function ext(path: string): string {
  const base = path.split("/").pop() || path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function monacoLang(path: string): string {
  const base = (path.split("/").pop() || path).toLowerCase();
  if (SPECIAL_NAMES[base]) return SPECIAL_NAMES[base];
  return EXT_LANG[ext(path)] || "plaintext";
}

// Extensions whose imports we try to parse for the knowledge graph.
const SOURCE_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  "py", "pyi", "go", "rs", "java", "kt", "c", "h", "cpp", "cc", "hpp",
  "cs", "rb", "php", "swift", "scala", "vue", "svelte",
]);

export function isSourceFile(path: string): boolean {
  // Skip vendored / generated trees that add noise to the graph.
  if (/(^|\/)(node_modules|\.git|dist|build|out|vendor|third_party|\.next|__pycache__)\//.test(path)) {
    return false;
  }
  if (/\.(min|d)\.[a-z]+$/.test(path)) return false;
  return SOURCE_EXTS.has(ext(path));
}

export function topDir(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}
