// U1 — /api/usage extracts the README's quickstart code + referenced symbols, so
// the usage-driven graph (U2+) can center on what runs when you follow the README.
import { startServer, waitHealthz, jpost, jget, freshDir, harness } from "./helpers.mjs";

const PORT = 8096;
const DATA = freshDir("/tmp/repolens-test-u1");
const REPO = "sindresorhus/slugify";
const h = harness("U1");

const s = startServer({ port: PORT, dataDir: DATA });
await waitHealthz(s.base);

await jpost(s.base, "/api/repo", { url: REPO }); // clone so the README is on disk
const u = await jget(s.base, `/api/usage?repo=${encodeURIComponent(REPO)}`);

h.check("returns README path", !!u.readmePath, u.readmePath);
h.check("returns usage snippets", Array.isArray(u.snippets) && u.snippets.length >= 1, `${u.snippets?.length} snippets`);
h.check("snippets carry code", (u.snippets || []).every((x) => x.code && x.code.length > 0));
h.check("returns referenced symbols", Array.isArray(u.symbols) && u.symbols.length >= 1, `${u.symbols?.length} symbols`);
h.check("symbols include the package's main fn (slugify)", (u.symbols || []).includes("slugify"), (u.symbols || []).slice(0, 8).join(", "));

console.log(`\n  metric: ${u.snippets?.length} snippets, ${u.symbols?.length} symbols — [${(u.symbols || []).slice(0, 6).join(", ")}]`);
s.stop();
h.done();
