"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { RepoRef } from "@/lib/types";
import { stripMdComments } from "@/lib/md";

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
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
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
