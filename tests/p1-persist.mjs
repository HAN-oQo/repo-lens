// P1 — Restore the viewed repo on reload. Pure serialize/parse round-trips a
// RepoRef through the URL query form, and a source assertion confirms a mount
// effect restores the saved repo (URL or localStorage) by calling loadRepo, and
// persists it on change. Metric: round-trip equality.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const { serializeRepoState, parseRepoState, repoStateToInput } = await import("../lib/persist.ts");
const h = harness("P1");

// --- pure round-trip ---
const cases = [
  { owner: "sindresorhus", repo: "slugify", branch: "main" },
  { owner: "HAN-oQo", repo: "repo-lens", branch: "" },           // no branch
  { owner: "a_b", repo: "c.d-e", branch: "feature/x" },          // slashed branch + punctuation
];
let allEq = true;
for (const ref of cases) {
  const s = serializeRepoState(ref);
  const back = parseRepoState(s);
  const eq = !!back && back.owner === ref.owner && back.repo === ref.repo && back.branch === ref.branch;
  if (!eq) allEq = false;
  h.check(`round-trips ${ref.owner}/${ref.repo}@${ref.branch || "(default)"}`, eq, `"${s}" → ${JSON.stringify(back)}`);
}
h.check("tolerates a leading '?'", parseRepoState("?repo=o/r&ref=main")?.repo === "r");
h.check("empty / non-repo string → null", parseRepoState("") === null && parseRepoState("foo=bar") === null);
h.check("serialize(null) → ''", serializeRepoState(null) === "");
h.check("repoStateToInput preserves branch via /tree/", repoStateToInput({ owner: "o", repo: "r", branch: "dev" }).includes("/tree/dev"));

// --- source assertion: mount restore + persist wiring ---
const page = readFileSync("app/page.tsx", "utf8");
h.check("page imports persist helpers", /from "@\/lib\/persist"/.test(page));
h.check("mount effect reads saved repo (URL or localStorage)", /parseRepoState\(window\.location\.search\)/.test(page) && /localStorage\.getItem\(REPO_STATE_LS\)/.test(page));
h.check("mount effect auto-loads it via loadRepo", /loadRepo\(repoStateToInput\(saved\)\)/.test(page));
h.check("persists repo to URL + localStorage on change", /serializeRepoState\(repo\)/.test(page) && /history\.replaceState/.test(page) && /localStorage\.setItem\(REPO_STATE_LS/.test(page));

console.log(`\n  metric: round-trip equality = ${allEq} across ${cases.length} refs (incl. empty + slashed branch)`);
h.done();
