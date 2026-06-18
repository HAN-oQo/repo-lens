// Tiny, dependency-free, XSS-safe Markdown → HTML for streaming AI answers.
// Ported from the blog's ask.js, with one addition: inline-code that names a
// repo file becomes a clickable <a class="filelink" data-path="...">.
// (README uses react-markdown instead; this one tolerates partial/streaming md.)

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Strip non-rendering meta that leaks into some READMEs: HTML comments and
 *  mkdocs/pymdownx snippet markers (e.g. `<!-- --8<-- [start:contact-us] -->`
 *  or bare `--8<--` include lines). */
export function stripMdComments(src: string): string {
  return String(src || "")
    .replace(/<!--[\s\S]*?-->/g, "")     // HTML comments (incl. snippet markers inside them)
    .replace(/^[ \t]*--8<--.*$/gm, "")   // bare pymdownx snippet markers
    .replace(/\n{3,}/g, "\n\n")          // collapse blank runs left behind
    .trimStart();
}

type PathResolver = (codeText: string) => string | null;

function inline(s: string, resolvePath?: PathResolver): string {
  // s is already HTML-escaped
  return s
    .replace(/`([^`]+)`/g, (_, c) => {
      if (resolvePath) {
        const p = resolvePath(c);
        if (p) return `<a class="filelink" data-path="${esc(p)}">${c}</a>`;
      }
      return "<code>" + c + "</code>";
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );
}

export function mdToHtml(src: string, resolvePath?: PathResolver): string {
  const lines = esc(stripMdComments(String(src || "")).trim()).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let code: string[] | null = null;
  let list: string | null = null;
  let listBuf: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list) {
      out.push("<" + list + ">" + listBuf.join("") + "</" + list + ">");
      list = null;
      listBuf = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.map((l) => inline(l, resolvePath)).join("<br>") + "</p>");
      para = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };
  for (const ln of lines) {
    const f = ln.match(/^```(.*)$/);
    if (f) {
      if (code !== null) {
        out.push("<pre><code>" + code.join("\n") + "</code></pre>");
        code = null;
      } else {
        flushAll();
        code = [];
      }
      continue;
    }
    if (code !== null) {
      code.push(ln);
      continue;
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushAll();
      const lv = Math.min(h[1].length + 2, 6);
      out.push("<h" + lv + ">" + inline(h[2], resolvePath) + "</h" + lv + ">");
      continue;
    }
    const ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = ln.match(/^\s*[-*+]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== "ol") {
        flushList();
        list = "ol";
      }
      listBuf.push("<li>" + inline(ol[1], resolvePath) + "</li>");
      continue;
    }
    if (ul) {
      flushPara();
      if (list !== "ul") {
        flushList();
        list = "ul";
      }
      listBuf.push("<li>" + inline(ul[1], resolvePath) + "</li>");
      continue;
    }
    const bq = ln.match(/^&gt;\s?(.*)$/);
    if (bq) {
      flushAll();
      out.push("<blockquote>" + inline(bq[1], resolvePath) + "</blockquote>");
      continue;
    }
    if (ln.trim() === "") {
      flushAll();
      continue;
    }
    flushList();
    para.push(ln);
  }
  if (code !== null) out.push("<pre><code>" + code.join("\n") + "</code></pre>");
  flushAll();
  return out.join("");
}
