"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { RepoRef } from "@/lib/types";
import { stripMdComments } from "@/lib/md";

// Many READMEs (e.g. vLLM) start with raw HTML — a centered logo, tagline, nav
// links. Render it (rehype-raw) but sanitize it (strip scripts/handlers). Extend
// the default GitHub schema to allow the layout tags/attrs these READMEs use, and
// keep className (so the language-* class survives for rehype-highlight).
const schema: any = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...((defaultSchema.attributes as any)?.["*"] || []), "align", "className"],
    img: [...((defaultSchema.attributes as any)?.img || []), "width", "height", "align"],
    source: ["srcSet", "srcset", "media", "type", "sizes"],
  },
};

/** Resolve a relative README URL against the repo (images → raw, links → blob). */
function makeResolver(repo: RepoRef, dir: string) {
  const rawBase = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}`;
  const blobBase = `https://github.com/${repo.owner}/${repo.repo}/blob/${repo.branch}`;
  return (url: string, kind: "img" | "link"): string => {
    if (!url || /^(https?:|mailto:|#|data:)/i.test(url)) return url;
    const clean = url.replace(/^\.?\//, "");
    const joined = dir ? `${dir}/${clean}` : clean;
    return `${kind === "img" ? rawBase : blobBase}/${joined}`;
  };
}

export default function MarkdownView({
  content,
  repo,
  readmeDir,
}: {
  content: string;
  repo: RepoRef;
  readmeDir: string;
}) {
  const resolve = makeResolver(repo, readmeDir);
  const clean = stripMdComments(content);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], [rehypeHighlight, { ignoreMissing: true }]]}
        components={{
          img: ({ src, alt, ...rest }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={typeof src === "string" ? resolve(src, "img") : undefined} alt={alt || ""} {...rest} />
          ),
          a: ({ href, children, ...rest }) => (
            <a href={href ? resolve(href, "link") : undefined} target="_blank" rel="noopener noreferrer" {...rest}>
              {children}
            </a>
          ),
        }}
      >
        {clean}
      </ReactMarkdown>
    </div>
  );
}
