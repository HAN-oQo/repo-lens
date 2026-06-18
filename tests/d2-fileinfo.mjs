// D2 — /api/fileinfo?repo=&path= returns a file's functions/classes (from the
// symbol graph) + their locations, so the Structure view (D4) can list per-file
// symbols. Asserts slugify's index.js yields its functions with line locations.
import { startServer, waitHealthz, jpost, jget, pollGraph, freshDir, harness } from "./helpers.mjs";

const PORT = 8094;
const DATA = freshDir("/tmp/repolens-test-d2");
const REPO = "sindresorhus/slugify";
const h = harness("D2");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);

await jpost(s.base, "/api/repo", { url: REPO }); // clone + kick off symbol-graph build
const g = await pollGraph(s.base, REPO);
h.check("graph ready", g.status === "ready", `status=${g.status} in ${g.ms}ms`);

const fi = await jget(s.base, `/api/fileinfo?repo=${encodeURIComponent(REPO)}&path=index.js`);
const names = (fi.symbols || []).map((x) => x.name);

h.check("status ready", fi.status === "ready", fi.status);
h.check("returns symbols array", Array.isArray(fi.symbols) && fi.symbols.length >= 3, `${fi.symbols?.length} symbols`);
h.check("includes slugify", names.includes("slugify"), names.join(", "));
h.check("includes decamelize", names.includes("decamelize"));
h.check("every symbol has a location/line", (fi.symbols || []).every((x) => x.line != null || x.location));
h.check("slugify classified as function", (fi.symbols || []).find((x) => x.name === "slugify")?.kind === "function");
h.check("file-level node excluded", !names.includes("index.js") && !names.includes("index"));

// missing/unmatched path → empty list, not an error
const empty = await jget(s.base, `/api/fileinfo?repo=${encodeURIComponent(REPO)}&path=does/not/exist.js`);
h.check("unknown path → empty symbols (no error)", Array.isArray(empty.symbols) && empty.symbols.length === 0 && !empty.error);

const slug = (fi.symbols || []).find((x) => x.name === "slugify");
console.log(`\n  metric: ${fi.symbols?.length} symbols in index.js — [${names.join(", ")}]`);
console.log(`  slugify → kind=${slug?.kind} line=${slug?.line} (${slug?.location})`);
s.stop();
h.done();
