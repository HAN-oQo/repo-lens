// Raw-HTML READMEs (e.g. vLLM's centered logo + nav links) must RENDER, not show
// their tags as text — and embedded <script>/handlers must be stripped. Renders the
// MarkdownView pipeline (rehype-raw + rehype-sanitize) via react-dom/server.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { harness } from "./helpers.mjs";

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...((defaultSchema.attributes || {})["*"] || []), "align", "className"],
    img: [...(((defaultSchema.attributes || {}).img) || []), "width", "height", "align"],
    source: ["srcSet", "srcset", "media", "type"],
  },
};
const input = `<p align="center"><h3 align="center">Easy, fast, and cheap LLM serving</h3><a href="https://docs.vllm.ai">Documentation</a></p>\n\n<script>alert(1)</script>\n\n## Real Heading\n\nSome **text**.`;
const out = renderToStaticMarkup(
  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeRaw, [rehypeSanitize, schema]], children: input })
);

const h = harness("MD-HTML");
h.check("HTML <h3> renders as an element", /<h3/.test(out));
h.check("HTML <a href> renders as a link", /<a href="https:\/\/docs\.vllm\.ai"/.test(out));
h.check("tags are NOT shown as escaped text", !out.includes("&lt;p"));
h.check("embedded <script> is sanitized away", !out.includes("alert(1)"));
h.check("normal markdown still works", /<h2/.test(out) && /<strong>text<\/strong>/.test(out));
console.log(`\n  metric: rendered ${out.length} chars of HTML; script stripped`);
h.done();
