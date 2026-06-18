# Repo Lens — Build Roadmap (`/next` ledger)

This file is the **source of truth for what to build next**. It survives session
and model changes — `/next` reads it, does the next unit, and checks it off here.

## Protocol (how `/next` uses this file)
- `/next` → pick the **first unit marked `[ ]`** top-to-bottom (skip `[!]` blocked),
  implement it, verify it, flip to `[x]` with a dated note, commit, report.
- `/next <ID>` → do that specific unit (e.g. `/next A2`).
- `/roadmap` → print current status, no changes.
- **Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
- Keep each unit **small** (one focused change). Flip the checkbox + add a note in
  the SAME commit as the change. One commit per unit.

## Test loop (localhost dev — current phase)
Backend v2 runs on **:8099** (frontend bundle is built with `API_BASE=:8099`).
After a change:
```bash
# rebuild frontend (only if app/, components/, lib/ changed)
BASE_PATH= NEXT_PUBLIC_API_BASE=http://localhost:8099 NEXT_PUBLIC_OAUTH_BASE=http://localhost:8099 npm run build
# restart backend (always picks up server/ changes + .env)
pkill -f "node server/server.mjs"; scripts/repolens.sh serve   # serve reads .env (PORT=8099, ASK_TOKEN…)
curl -s localhost:8099/healthz   # → ok
```
Verify with `curl` against `/api/*` and/or the headless notes. Token is in `.env`
(`ASK_TOKEN`, gitignored). Commit + push to **HAN-oQo** then restore `hanq-moreh`
(see CLAUDE.md). Keep context lean (~100k); state lives here, not in memory.

---

## Goal 1 — Speed (localhost feels instant)
- [ ] **S1 — Reload graph from disk (skip rebuild).** On `getGraph`/`requestGraph`,
  if `<clone>/graphify-out/graph.json` exists and the repo's HEAD sha is unchanged,
  load `toGraphData(json)` straight from disk instead of re-running `graphify update`.
  Persist the resolved sha alongside. *Accept:* after a server restart, opening a
  previously-built repo's graph returns `ready` in <2s (no multi-minute rebuild).
- [ ] **S2 — Explorer big-dir cap.** When a directory has > 300 children, render the
  first 300 + a "… N more (show all)" row. *Accept:* expanding a 5k-file dir (pytorch
  `torch/`) doesn't freeze; toggling "show all" reveals the rest.
- [ ] **S3 — Ask retrieval budget.** Cap GraphRAG to the top ~6 files / 30k chars and
  log how long retrieval vs LLM took. *Accept:* `/api/ask` retrieval phase < 1.5s on
  a large repo (LLM time excluded); activity log shows the split.
- [ ] **S4 — Persist adapted graph cache across restarts (optional).** Cache the
  capped overview + full GraphData to `<data>/cache/<owner>_<repo>.json` keyed by sha.
  *Accept:* repeat loads of a big repo never touch graphify.

## Goal 2 — Ask panel cleanup (only what works on localhost)
- [ ] **A1 — Hide BYO-provider + API-key UI in backend mode.** When `hasBackend`, the
  settings should NOT offer provider selection or API-key/URL inputs (they don't work
  here). Keep only the model dropdown. *Accept:* on :8099 the ⚙ settings shows no
  API-key field; Ask still works via the inline model picker.
- [ ] **A2 — Remove the EN/KO language toggle.** Drop the `한/EN` button and the `ko`
  plumbing from the UI (default English). *Accept:* no language toggle in the Ask
  header; Ask answers in English.
- [ ] **A3 — Simplify Ask header/settings.** With A1+A2 done, the ⚙ gear in backend
  mode is near-empty — either remove it or reduce to just the model picker + "new chat".
  *Accept:* no dead controls in the Ask panel on localhost.

## Goal 3 — Usage-driven graph (README flow first, with examples)
- [ ] **U1 — Extract README usage.** Backend helper: pull the "usage/quickstart" code
  blocks + the symbols/commands they reference from the README. *Accept:* `/api/usage?repo=`
  returns the usage code snippets + a list of referenced top-level symbols.
- [ ] **U2 — Usage-flow subgraph.** Map those entry-point symbols to graph nodes and
  build a focus subgraph (the "what runs when you follow the README" flow). *Accept:*
  for slugify, the usage flow centers on `slugify()` and its callees.
- [ ] **U3 — Suggested entry points.** Backend returns 3–5 example questions/flows
  derived from the README usage + top hubs. *Accept:* `/api/repo` (or `/api/suggest`)
  returns example prompts like "Trace what happens when you call `slugify(input)`".
- [ ] **U4 — Graph defaults to the usage flow.** When the graph tab opens, show the
  usage-flow subgraph first (not the 600-node overview); "Full overview" button
  switches to the overview. *Accept:* opening the graph on a fresh repo shows the
  usage flow immediately.
- [ ] **U5 — Example chips in the UI.** Render the suggested entry points as clickable
  chips (in the graph panel and/or Ask); clicking focuses that flow. *Accept:* clicking
  a chip swaps the graph to that flow's subgraph.

## Goal 4 — Directory map (structure + roles + flow)
- [ ] **D1 — Structure panel + activity-bar icon.** New left view (📂) that shows the
  directory tree in a clean Finder-like layout (separate from the file Explorer).
  *Accept:* a new activity-bar button opens a structure view listing top-level dirs.
- [ ] **D2 — Per-file symbol list.** Backend `/api/fileinfo?repo=&path=` returns the
  file's functions/classes (from the graphify graph: nodes whose sourceFile == path)
  with their locations. *Accept:* for `index.js` it lists `slugify`, `decamelize`, etc.
- [ ] **D3 — Summaries (dir / file / function), cached.** Bottom-up LLM summaries: file
  role from its symbols, directory role from its files. Cache to disk keyed by sha.
  *Accept:* `/api/summary?repo=&path=` returns a one-line role; second call is instant
  (cached). Rate-limited / lazy so it doesn't summarize the whole repo at once.
- [ ] **D4 — Drill-down UI.** Structure panel: each dir shows its role; expand → files
  with roles; expand a file → its functions with roles. *Accept:* you can expand
  dir → file → function and see a one-line role at each level.
- [ ] **D5 — Command-flow visualization.** Given an entry command/usage, show the
  ordered call sequence through symbols as a colored/numbered path (mind-map style).
  *Accept:* "follow `slugify(input)`" highlights the call order 1→2→3 across nodes.

---

## Backlog / later (not localhost-blocking)
- CE deploy of all the above (already documented in `docs/repo-lens-ce-deploy.html`).
- Public Pages demo flip to the CE backend.
- Feature B from earlier (step-by-step walk animation) overlaps with D5.

## Changelog (most recent first)
<!-- /next appends: `- YYYY-MM-DD <ID> — what was done (verified: how)` -->
