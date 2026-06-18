# Repo Lens — Build Roadmap (`/next` ledger)

This file is the **source of truth for what to build next**. It survives session
and model changes — `/next` reads it, does the next unit, and checks it off here.

## A unit is DONE only when: implemented → tested → run → result recorded
Every unit carries:
- **Change** — the focused implementation.
- **Test** — a minimal, runnable test at `tests/<id>.mjs` that asserts the goal
  and prints any **metric** (e.g. speed before/after). Uses `tests/helpers.mjs`
  (spins up its own backend on a test port + temp data dir; never touches :8099).
- **Result** — filled when done: `PASS/FAIL <date> — <metrics / what was observed>`.

A unit cannot be flipped to `[x]` without a passing `tests/<id>.mjs` and a recorded
Result. Run a test with `node tests/<id>.mjs` (exit 0 = pass).

## Protocol (how `/next` uses this file)
- `/next` → first unit marked `[ ]` (skip `[!]`); implement → write `tests/<id>.mjs`
  → run it → record **Result** → flip `[x]` + Changelog → one commit. `/next <ID>`
  targets a unit. `/roadmap` prints status.
- **Status:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked
- Keep units small. Checkbox + Result + Changelog flip in the SAME commit.

## Test loop (localhost dev — current phase)
Backend v2 runs on **:8099** (bundle built with `API_BASE=:8099`). Unit tests use
their own port, so they run independently. After a change:
```bash
# rebuild frontend (only if app/, components/, lib/ changed)
# NEXT_PUBLIC_BUILD stamps the git sha into the status bar ("Repo Lens · <sha>") so
# you can confirm in-browser that you're on the new build (vs a stale cached bundle).
BASE_PATH= NEXT_PUBLIC_API_BASE=http://localhost:8099 NEXT_PUBLIC_OAUTH_BASE=http://localhost:8099 NEXT_PUBLIC_BUILD=$(git rev-parse --short HEAD) npm run build
pkill -f "node server/server.mjs"; scripts/repolens.sh serve   # reads .env (PORT=8099, ASK_TOKEN…)
node tests/<id>.mjs                                            # the unit's test → PASS/FAIL + metric
```
Token is in `.env` (`ASK_TOKEN`, gitignored). Commit + push to **HAN-oQo**, restore
`hanq-moreh` (CLAUDE.md). Keep context lean (~100k); state lives here, not in memory.

---

## Goal 1 — Speed (localhost feels instant)
- [x] **S1 — Reload graph from disk (skip rebuild).** If `<clone>/graphify-out/graph.json`
  exists and HEAD sha matches a `.repolens-sha` sidecar, load `toGraphData(json)`
  from disk instead of re-running `graphify update`.
  - *Test:* `tests/s1-graph-cache.mjs` — build slugify graph → restart backend →
    reload; assert ready in <2000ms + activity log shows "reusing cached build".
  - *Result:* PASS 2026-06-18 — first_build=612ms, cached_reload=206ms (3.0x), graphify skipped.
- [x] **S2 — Explorer big-dir cap.** Directories with > 300 children render the first
  300 + a "… N more (show all)" row. (`lib/tree.ts` `visibleChildren`; Explorer per-dir
  show-all state + "more" row.)
  - *Test:* `tests/s2-bigdir.mjs` — build a synthetic FileNode tree with a 5000-child
    dir; assert the rendered row count is capped until "show all" (test the cap helper
    / component logic, not a live browser). Metric: rows rendered before vs after.
  - *Result:* PASS 2026-06-18 — 5000-child dir → 300 rows (16.7x fewer), show-all → 5000, small dirs uncapped; build green.
- [x] **S3 — Ask retrieval budget + timing.** Cap GraphRAG to top ~6 files / 30k chars;
  log retrieval-vs-LLM time split. (`TOTAL_CAP=30000`, `MAX_FILES=6`; `ask` logs
  `retrieved N files / M chars in Xms · LLM Yms` and returns `timing`.)
  - *Test:* `tests/s3-retrieval.mjs` — call the retrieval/buildContext path on a repo;
    assert context ≤ 30k chars and retrieval phase < 1500ms (LLM excluded). Metric: retrieval ms, context size.
  - *Result:* PASS 2026-06-18 — retrieval=60ms, 4 files, 21,360 chars (≤30k budget); LLM split now logged.
- [!] **S4 — Persist adapted graph cache across restarts (optional).** Cache capped
  overview + full GraphData to `<data>/cache/<owner>_<repo>.json` keyed by sha.
  - *Test:* `tests/s4-graphcache.mjs` — build → restart → assert no graphify spawn at
    all (even the disk graph.json read is skipped in favor of the adapted cache). Metric: reload ms.
  - *Result:* DEFERRED 2026-06-18 — superseded by S1 (disk graph.json reuse already
    avoids graphify on repeat loads; cached_reload was 206ms). Only marginal toGraphData
    savings remain. Reopen with `/next S4` if toGraphData becomes a bottleneck on huge repos.

## Goal 2 — Ask panel cleanup (only what works on localhost)
- [x] **A1 — Hide BYO-provider + API-key UI in backend mode.** When `hasBackend`, no
  provider select / API-key / URL inputs; keep the model dropdown. (Ask settings now
  branch on `hasBackend` — backend mode shows a one-line "no key needed" note + Close.)
  - *Test:* `tests/a1-ask-ui.mjs` — grep the built `out/` bundle (or component source)
    to assert the API-key field / provider select is gated behind `!hasBackend`. Metric: count of removed controls.
  - *Result:* PASS 2026-06-18 — 3 BYO controls (provider, server URL, API key) gated behind `!hasBackend`; inline model picker stays; build green. (Visual absence confirmed manually in browser.)
- [x] **A2 — Remove the EN/KO language toggle.** Drop the `한/EN` button and `ko`
  plumbing; default English. (Removed toggle button, `ko` state, `toggleLang`, `LS_LANG`;
  `t()` ignores its 2nd arg; system prompt forces English.)
  - *Test:* `tests/a2-no-lang-toggle.mjs` — assert no language-toggle markup in the
    built bundle; `/api/ask` answers in English by default.
  - *Result:* PASS 2026-06-18 — toggle button + ko state gone; system prompt "Answer in English"; "언어" absent from built bundle (0 chunks). (Live answer-language check manual.)
- [x] **A3 — Simplify Ask header/settings.** With A1+A2, reduce the ⚙ to model picker +
  "new chat" (or remove). (Backend mode: ⚙ removed since A1 emptied it; model dropdown
  no longer gated on a loaded repo, so it's always visible.)
  - *Test:* `tests/a3-ask-clean.mjs` — assert no dead controls remain (source/bundle check).
  - *Result:* PASS 2026-06-18 — ⚙ gated behind !hasBackend; model picker condition dropped the `ctx.repoRef` gate (always visible); build green.

## Goal 3 — Usage-driven graph (README flow first, with examples)
- [x] **U1 — Extract README usage.** Backend pulls quickstart code blocks + referenced
  symbols from the README. (`server/lib/usage.mjs` `extractUsage`/`referencedSymbols`;
  `GET /api/usage?repo=`.)
  - *Test:* `tests/u1-usage.mjs` — `/api/usage?repo=slugify` returns usage snippets +
    referenced symbols incl. `slugify`. Metric: # snippets, # symbols.
  - *Result:* PASS 2026-06-18 — slugify: 4 snippets, symbols [slugify, slugifyWithCounter, reset].
- [x] **U2 — Usage-flow subgraph.** Map entry-point symbols → focus subgraph.
  (`extractSubgraphBySymbols` seeds by symbol name; `buildUsageFlowGraph`; `GET /api/usageflow`.)
  - *Test:* `tests/u2-usageflow.mjs` — for slugify the usage subgraph contains `slugify`
    and its callees; node count < full. Metric: focus node count.
  - *Result:* PASS 2026-06-18 — slugify usage-flow = 18 nodes / 21 links (vs full 68), centers on slugify, seeded by [slugify, slugifyWithCounter, reset].
- [x] **U3 — Suggested entry points.** Backend returns 3–5 example prompts/flows.
  (`suggestEntryPoints` in usage.mjs from README symbols + graph hubs; `GET /api/suggest`;
  each {label, question, symbol?} — usage traces up front, "Repo overview" always offered.)
  - *Test:* `tests/u3-suggest.mjs` — `/api/suggest?repo=` (or `/api/repo`) returns
    ≥3 example prompts. Metric: # suggestions.
  - *Result:* PASS 2026-06-18 — slugify: 5 [Trace slugify(), Trace slugifyWithCounter(), Trace reset(), How does buildPatternSlug work?, Repo overview].
- [x] **U4 — Graph defaults to the usage flow.** Graph tab opens on the usage-flow
  subgraph; "Full overview" switches. (openGraph fetches `apiUsageFlow` after build →
  default focus + "Usage flow" label; GraphView renders focus over overview.)
  - *Test:* `tests/u4-default-flow.mjs` — first graph payload for a fresh repo is the
    usage subgraph (flagged), not the 600-node overview.
  - *Result:* PASS 2026-06-18 — wiring asserted; slugify default flow = 18 nodes vs overview 68; build green. (Visual default confirmed manually.)
- [x] **U4b — Directed flow layout (DAG) for the focus/usage graph.** The force blob
  doesn't read as a flow. When a focus/usage-flow graph is shown, lay it out as a
  left→right DAG (react-force-graph `dagMode="lr"` + `onDagError` to tolerate cycles +
  `dagLevelDistance`) so the entry point is left and callees fan out rightward with
  directional arrows. Overview keeps the normal force layout.
  - *Test:* `tests/u4b-dag.mjs` — source assertion: GraphView sets `dagMode="lr"` when
    `focusGraph` is active and provides `onDagError`; overview (no focus) uses no dagMode.
    Build green. (Visual layout confirmed manually.) Metric: dag enabled for focus only.
  - *Result:* PASS 2026-06-18 — focus graph uses `dagMode="lr"` + `onDagError`; overview unchanged (force); build green. Readability follow-up: labels always shown in focus, drawn on a background pill at ~constant screen size, `dagLevelDistance=110` for spacing (was overlapping). Test 8/8. (Left→right flow confirmed manually.)
- [!] **U5 — Example chips in the UI.** MERGED into Goal 6 (V6). The `/api/suggest` chips
  trigger the same query→view flow as V6's query-driven tabs; building them separately
  (chips→focus) would just be reworked by V6. V6 now renders the chips + opens the tab.

## Goal 4 — Directory map (structure + roles + flow)
- [ ] **D1 — Structure panel + activity-bar icon.** New 📂 left view, Finder-like dir tree.
  - *Test:* `tests/d1-structure.mjs` — bundle/source check: new activity-bar button +
    structure view component present and wired.
  - *Result:* (pending)
- [ ] **D2 — Per-file symbol list.** `/api/fileinfo?repo=&path=` returns a file's
  functions/classes (from graph nodes) + locations.
  - *Test:* `tests/d2-fileinfo.mjs` — for slugify `index.js`, returns `slugify`,
    `decamelize`, etc. with locations. Metric: # symbols.
  - *Result:* (pending)
- [ ] **D3 — Summaries (dir/file/function), cached.** Bottom-up LLM summaries, cached to
  disk keyed by sha, lazy/rate-limited.
  - *Test:* `tests/d3-summary.mjs` — `/api/summary?repo=&path=` returns a one-line role;
    second call is cache-fast. Metric: first vs cached ms.
  - *Result:* (pending)
- [ ] **D4 — Drill-down UI.** dir role → file roles → function roles, expandable.
  - *Test:* `tests/d4-drilldown.mjs` — source/bundle check: structure view renders role
    at each level from `/api/fileinfo` + `/api/summary`.
  - *Result:* (pending)
- [!] **D5 — Command-flow visualization.** MERGED into Goal 6. "Ordered/colored call path /
  mind-map" = the DAG (U4b) + call-tree (V2) + mermaid (V3) renderers applied to a flow
  subgraph (`extractSubgraphBySymbols` already produces the path). No separate `/api/flow`.

---

## Goal 5 — Session persistence (don't lose your place on reload)
- [ ] **P1 — Restore the viewed repo on reload.** A page refresh currently drops the
  loaded repo back to the empty state. Persist the loaded repo (owner/repo/branch) to
  the URL (`?repo=owner/repo&ref=branch`) + localStorage; on mount, auto-load it so a
  refresh keeps you on the same repo (until the user clears storage/cache or loads a new
  repo). Pure helpers `serializeRepoState`/`parseRepoState` for testability.
  - *Test:* `tests/p1-persist.mjs` — round-trip a RepoRef through serialize→query/string→parse
    and assert equality; source assertion that a mount effect reads the saved repo and calls
    `loadRepo`. Metric: round-trip equality.
  - *Result:* (pending)
- [ ] **P2 — Restore open tabs + active tab on reload.** Persist the open file tabs +
  active tab per repo (localStorage, keyed by owner/repo); restore them after the repo
  loads so refresh keeps your open files, not just the repo. **(Depends on Goal 6's tab
  model — do after V5/V6 so we persist the final tab shape, not a soon-reworked one.)**
  - *Test:* `tests/p2-tabs.mjs` — tab list serialize/parse round-trips; source assertion
    that tabs are restored for the matching repo on load. Metric: tabs restored.
  - *Result:* (pending)

## Goal 6 — Visualization views + query-driven tabs
The force blob reads differently per repo, so make the visualization **pluggable** and
let the user pick. Left rail gains viz entries (Force overview · DAG flow · Call-tree /
step-list · Mermaid flowchart) next to File · Search. Each viz opens with **Overview** +
**Quickstart** tabs; asking *"show X as a DAG / call tree / flowchart"* spawns a **new
tab** rendering that query's focus subgraph in the chosen visualization.
- [ ] **V1 — Pluggable graph render modes.** One graph component renders a `GraphData`
  in `mode ∈ {force, dag, tree, mermaid}` (mode chosen via V4's left-rail entries, not a
  second in-panel switcher). Fold the existing force-overview + dag-flow (U4b) behind it.
  - *Test:* `tests/v1-modes.mjs` — component accepts a `mode` prop and branches to each
    renderer; the same data renders in every mode without error. Metric: # modes.
  - *Result:* (pending)
- [ ] **V2 — Call-tree / step-list view.** Pure `toCallTree(graph, root?)` → ordered,
  numbered, nested steps from the entry node (follow directed links, break cycles);
  component renders indented rows, click → open `sourceFile`.
  - *Test:* `tests/v2-calltree.mjs` — `toCallTree` on the slugify usage subgraph yields
    a tree rooted at `slugify` with ordered children, no infinite loop. Metric: depth, node count.
  - *Result:* (pending)
- [ ] **V3 — Mermaid flowchart view.** Add `mermaid` dep; pure `toMermaid(graph)` →
  `flowchart LR` string (sanitized ids, directed edges); component renders it, node click
  → open file.
  - *Test:* `tests/v3-mermaid.mjs` — `toMermaid(subgraph)` starts with `flowchart LR`,
    includes a `slugify --> …` edge, and `mermaid.parse()` accepts it. Metric: nodes/edges.
- [ ] **V4 — Left activity-bar viz entries.** Add buttons for the viz modes (DAG /
  call-tree / mermaid) beside File · Search · Graph; selecting one sets the active viz.
  - *Test:* `tests/v4-activitybar.mjs` — page source/bundle: the new activity-bar buttons
    exist and set the viz mode. Metric: # buttons added.
  - *Result:* (pending)
- [ ] **V5 — Default tabs: Overview + Quickstart.** On repo load the graph area seeds two
  tabs — "Overview" (full graph) and "Quickstart" (usage-flow) — rendered in the current viz.
  - *Test:* `tests/v5-default-tabs.mjs` — after load the tab set includes Overview +
    Quickstart; backend data for both is present. Metric: tabs seeded.
  - *Result:* (pending)
- [ ] **V6 — Query-driven tabs (+ suggestion chips).** Parse the Ask question for a
  requested viz + target ("show the request flow as a flowchart") and, on answer, open a
  NEW tab holding that query's focus subgraph in the requested viz (default DAG). Also
  render the `/api/suggest` items as clickable chips that open these tabs (absorbs U5).
  - *Test:* `tests/v6-query-tabs.mjs` — pure `parseVizRequest("… as a flowchart")` →
    `{ viz:"mermaid" }` (and "dag"/"call tree" variants); handleAskDone opens a tab;
    chips render from /api/suggest (source assertion). Metric: viz parsed for each phrasing.
  - *Result:* (pending)

## Goal 7 — Cleanup & DRY (bounded; no behavior change)
- [ ] **C1 — Dedupe the README-read block + scan for dead code.** `/api/usage`,
  `/api/usageflow`, `/api/suggest` each repeat `listTree → findReadme → readRepoFile`;
  extract one `readRepoReadme(dir)` helper (in repo.mjs) and use it in all three. Also
  scan for clearly-unused exports/keys and drop them. No behavior change.
  - *Test:* `tests/c1-cleanup.mjs` — runs the existing endpoint tests' data path (usage/
    suggest still return the same shape) + asserts the 3 endpoints call the shared helper
    (source: no repeated `findReadme(` blocks in api.mjs). Build green. Metric: LOC removed.
  - *Result:* (pending)
  - *Note:* the A2 leftover Korean strings in `t("en","ko")` call sites are harmless dead
    args (ignored at runtime); not worth touching ~30 sites for no functional gain — skip.

## Backlog / later (not localhost-blocking)
- CE deploy of all the above (`docs/repo-lens-ce-deploy.html`).
- Public Pages demo flip to the CE backend.
- Step-by-step walk animation along a flow path — overlaps Goal 6 (V2/V3); revisit after.

## Changelog (most recent first)
<!-- /next appends: `- YYYY-MM-DD <ID> — what was done (test: tests/<id>.mjs, result)` -->
- 2026-06-18 U4b — focus/usage-flow graph laid out as a left→right DAG (dagMode=lr + onDagError) so call order reads as a flow; overview stays force. test: tests/u4b-dag.mjs PASS. (added per user feedback — force blob didn't read as a flow.)
- 2026-06-18 U4 — graph tab defaults to the README usage-flow subgraph (openGraph→apiUsageFlow→focus); "Full overview" switches. test: tests/u4-default-flow.mjs PASS — default 18 vs overview 68.
- 2026-06-18 U3 — /api/suggest returns 3–5 example entry-point prompts (README symbols + hubs). test: tests/u3-suggest.mjs PASS — slugify 5 suggestions, usage traces + overview.
- 2026-06-18 U2 — usage-flow subgraph seeded by README symbols (extractSubgraphBySymbols + /api/usageflow). test: tests/u2-usageflow.mjs PASS — slugify flow 18/68 nodes, centers on slugify.
- 2026-06-18 U1 — /api/usage extracts README quickstart snippets + referenced symbols (server/lib/usage.mjs). test: tests/u1-usage.mjs PASS — slugify: 4 snippets, [slugify, slugifyWithCounter, reset].
- 2026-06-18 A2 — removed EN/KO toggle + ko plumbing; UI English-only. test: tests/a2-no-lang-toggle.mjs PASS — "언어" gone from bundle. (Goal 2 Ask cleanup complete.)
- 2026-06-18 A3 — backend Ask: removed the now-empty ⚙ button; model dropdown always visible (dropped repo gate). test: tests/a3-ask-clean.mjs PASS. (done out of order to fix the awkward post-A1 state — A2 still pending.)
- 2026-06-18 A1 — Ask settings hide provider/URL/API-key in backend mode (only inline model picker). test: tests/a1-ask-ui.mjs PASS — 3 controls gated behind !hasBackend.
- 2026-06-18 S4 — DEFERRED ([!]) — superseded by S1; reopen with /next S4 if toGraphData becomes a bottleneck.
- 2026-06-18 S3 — GraphRAG capped to 6 files / 30k chars + retrieval/LLM timing logged. test: tests/s3-retrieval.mjs PASS — retrieval=60ms, 4 files, 21,360 chars.
- 2026-06-18 S2 — Explorer caps >300-child dirs (visibleChildren helper + "show all" row). test: tests/s2-bigdir.mjs PASS — 5000→300 rows (16.7x fewer), show-all reveals all.
- 2026-06-18 S1 — disk-cached graph reuse (sha sidecar) skips `graphify update`. test: tests/s1-graph-cache.mjs PASS — first_build=612ms, cached_reload=206ms (3.0x), graphify skipped.
