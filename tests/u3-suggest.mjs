// U3 — /api/suggest returns 3–5 clickable example entry points built from the
// README usage symbols + graph hubs (each carries a label + question, some a symbol
// to focus on). Drives the U5 example chips.
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const PORT = 8094;
const DATA = freshDir("/tmp/repolens-test-u3");
const REPO = "sindresorhus/slugify";
const h = harness("U3");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);

await jpost(s.base, "/api/repo", { url: REPO });
await pollGraph(s.base, REPO); // so hub-based suggestions are available too

const r = await jget(s.base, `/api/suggest?repo=${encodeURIComponent(REPO)}`);
const sug = r.suggestions || [];

h.check("returns at least 3 suggestions", sug.length >= 3, `${sug.length}`);
h.check("at most 5 suggestions", sug.length <= 5, `${sug.length}`);
h.check("each has a label + question", sug.every((x) => x.label && x.question));
h.check("at least one references a usage symbol (slugify)", sug.some((x) => /slugify/i.test(x.symbol || x.question)));
h.check("includes a generic overview prompt", sug.some((x) => /overview/i.test(x.label + x.question)));

console.log(`\n  metric: ${sug.length} suggestions — [${sug.map((x) => x.label).join(" | ")}]`);
s.stop();
h.done();
