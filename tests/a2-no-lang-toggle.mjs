// A2 — the EN/KO language toggle is gone and the UI defaults to English.
// Source check on AskPanel + built-bundle check that the toggle's unique marker
// ("언어", the toggle button title) no longer ships. Actual answer language is
// enforced by the English-only system prompt (manual/endpoint confirmation).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { harness } from "./helpers.mjs";

const src = readFileSync("components/AskPanel.tsx", "utf8");
const h = harness("A2");

h.check("no toggleLang function", !src.includes("toggleLang"));
h.check("no ko state", !/\bconst \[ko, setKo\]/.test(src));
h.check('no {ko ? "한" : "EN"} toggle button', !src.includes('"한"'));
h.check("system prompt forces English", src.includes("`Answer in English.`") && !src.includes('ko ? "Korean"'));

// built bundle no longer contains the toggle title "언어"
let bundleHits = "?";
try {
  bundleHits = execSync("grep -rl '언어' out/_next/static/chunks 2>/dev/null | wc -l").toString().trim();
} catch { bundleHits = "0"; }
h.check("toggle title (언어) absent from built bundle", bundleHits === "0", `chunks with 언어: ${bundleHits}`);

console.log("\n  metric: language toggle removed (button + ko state + LS_LANG); UI English-only");
h.done();
