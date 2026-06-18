// A1 — in backend mode the Ask settings show no provider select / server URL /
// API-key input (they don't work on localhost); only the inline model picker
// remains. Static source check: those controls live in the `!hasBackend` branch.
// (The actual rendered absence is confirmed manually in the browser.)
import { readFileSync } from "node:fs";
import { harness } from "./helpers.mjs";

const src = readFileSync("components/AskPanel.tsx", "utf8");
const h = harness("A1");

const setIdx = src.indexOf('className="ask-set"');
const tern = src.indexOf("hasBackend ?", setIdx);
const elseIdx = src.indexOf(") : (", tern);
h.check("settings panel branches on hasBackend", setIdx >= 0 && tern > setIdx && elseIdx > tern);

const keyIdx = src.indexOf('type="password"');     // the API-key input
const provIdx = src.indexOf('{t("Provider"');        // the provider <select>
const urlIdx = src.indexOf('{t("Server URL"');       // the server URL input
h.check("API-key input is gated behind !hasBackend", keyIdx > elseIdx, `key@${keyIdx} > else@${elseIdx}`);
h.check("provider select is gated behind !hasBackend", provIdx > elseIdx);
h.check("server URL is gated behind !hasBackend", urlIdx > elseIdx);
h.check("backend branch tells user no key is needed", src.slice(tern, elseIdx).includes("No API key needed"));

const hidden = ['{t("Provider"', '{t("Server URL"', 'type="password"'].filter((s) => src.indexOf(s) > elseIdx).length;
console.log(`\n  metric: ${hidden} BYO controls hidden in backend mode (provider, server URL, API key); inline model picker stays`);
h.done();
