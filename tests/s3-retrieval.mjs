// S3 — GraphRAG retrieval stays within budget (≤6 files / ≤30k chars) and is fast
// (the slow part is the LLM, which this test excludes). Clones a small repo and
// calls retrieveContext directly, measuring the retrieval phase only.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { harness, sleep } from "./helpers.mjs";

const DIR = "/tmp/repolens-test-s3/slugify";
try { rmSync("/tmp/repolens-test-s3", { recursive: true, force: true }); } catch {}

function run(cmd, args) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("close", (code) => res(code));
    p.on("error", () => res(-1));
  });
}

const h = harness("S3");

// shallow-clone a small repo to retrieve against (no server needed)
const code = await run("git", ["clone", "--depth", "1", "https://github.com/sindresorhus/slugify", DIR]);
h.check("cloned test repo", code === 0);

const { retrieveContext } = await import("../server/lib/graphrag.mjs");
// warm + measure
const r = await retrieveContext("sindresorhus", "slugify", DIR, "how does the separator option work?", undefined);

h.check("retrieval returns context", r.context.length > 0, `${r.context.length} chars`);
h.check("context within 30k budget", r.context.length <= 30000, `${r.context.length} chars`);
h.check("at most 6 source files", r.sources.length <= 6, `${r.sources.length} files`);
h.check("retrieval is fast (<1500ms, LLM excluded)", r.ms < 1500, `${r.ms}ms`);

console.log(`\n  metric: retrieval=${r.ms}ms · ${r.sources.length} files · ${r.context.length} chars (budget 30000)`);
h.done();
