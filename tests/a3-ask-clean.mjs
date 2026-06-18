// A3 — Ask panel has no dead controls in backend mode: the (now-empty) ⚙ settings
// button is hidden, and the model picker is always available (not gated on a loaded
// repo). Static source check; visual confirmed manually in the browser.
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const src = readFileSync("components/AskPanel.tsx", "utf8");
const h = harness("A3");

// 1) the ⚙ settings button only renders when !hasBackend
const setBtn = src.indexOf('title={t("Settings"');
const guardBefore = src.lastIndexOf("!hasBackend", setBtn);
h.check("⚙ settings button gated behind !hasBackend", setBtn > 0 && guardBefore > 0 && setBtn - guardBefore < 120, `gap ${setBtn - guardBefore}`);

// 2) the inline model picker no longer requires a loaded repo
h.check("model picker shown without a repo (no ctx.repoRef gate)", !src.includes("ctx.repoRef && beModels"));
h.check("model picker condition is hasBackend && beModels", src.includes("hasBackend && beModels && (beModels.cloud"));

// 3) model picker still renders the cloud + local groups
h.check("model dropdown present (ask-msel)", src.includes('className="ask-msel"'));

console.log("\n  metric: backend mode = no ⚙ (empty), model dropdown always visible (repo not required)");
h.done();
