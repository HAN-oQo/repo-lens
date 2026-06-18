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
- [ ] **U2 — Usage-flow subgraph.** Map entry-point symbols → focus subgraph.
  - *Test:* `tests/u2-usageflow.mjs` — for slugify the usage subgraph contains `slugify`
    and its callees; node count < full. Metric: focus node count.
  - *Result:* (pending)
- [ ] **U3 — Suggested entry points.** Backend returns 3–5 example prompts/flows.
  - *Test:* `tests/u3-suggest.mjs` — `/api/suggest?repo=` (or `/api/repo`) returns
    ≥3 example prompts. Metric: # suggestions.
  - *Result:* (pending)
- [ ] **U4 — Graph defaults to the usage flow.** Graph tab opens on the usage-flow
  subgraph; "Full overview" switches.
  - *Test:* `tests/u4-default-flow.mjs` — first graph payload for a fresh repo is the
    usage subgraph (flagged), not the 600-node overview.
  - *Result:* (pending)
- [ ] **U5 — Example chips in the UI.** Clickable suggested entry points → focus that flow.
  - *Test:* `tests/u5-chips.mjs` — built bundle renders chips from `/api/suggest`; clicking
    calls focus (source/bundle check + endpoint smoke).
  - *Result:* (pending)

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
- [ ] **D5 — Command-flow visualization.** Ordered, colored/numbered call path for an
  entry command (mind-map style).
  - *Test:* `tests/d5-flow.mjs` — `/api/flow?repo=&entry=slugify` returns an ordered node
    sequence; assert order 1→2→3 is a valid path in the graph. Metric: path length.
  - *Result:* (pending)

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
  loads so refresh keeps your open files, not just the repo.
  - *Test:* `tests/p2-tabs.mjs` — tab list serialize/parse round-trips; source assertion
    that tabs are restored for the matching repo on load. Metric: tabs restored.
  - *Result:* (pending)

## Backlog / later (not localhost-blocking)
- CE deploy of all the above (`docs/repo-lens-ce-deploy.html`).
- Public Pages demo flip to the CE backend.
- Feature B (step-by-step walk animation) overlaps with D5.

## Changelog (most recent first)
<!-- /next appends: `- YYYY-MM-DD <ID> — what was done (test: tests/<id>.mjs, result)` -->
- 2026-06-18 U1 — /api/usage extracts README quickstart snippets + referenced symbols (server/lib/usage.mjs). test: tests/u1-usage.mjs PASS — slugify: 4 snippets, [slugify, slugifyWithCounter, reset].
- 2026-06-18 A2 — removed EN/KO toggle + ko plumbing; UI English-only. test: tests/a2-no-lang-toggle.mjs PASS — "언어" gone from bundle. (Goal 2 Ask cleanup complete.)
- 2026-06-18 A3 — backend Ask: removed the now-empty ⚙ button; model dropdown always visible (dropped repo gate). test: tests/a3-ask-clean.mjs PASS. (done out of order to fix the awkward post-A1 state — A2 still pending.)
- 2026-06-18 A1 — Ask settings hide provider/URL/API-key in backend mode (only inline model picker). test: tests/a1-ask-ui.mjs PASS — 3 controls gated behind !hasBackend.
- 2026-06-18 S4 — DEFERRED ([!]) — superseded by S1; reopen with /next S4 if toGraphData becomes a bottleneck.
- 2026-06-18 S3 — GraphRAG capped to 6 files / 30k chars + retrieval/LLM timing logged. test: tests/s3-retrieval.mjs PASS — retrieval=60ms, 4 files, 21,360 chars.
- 2026-06-18 S2 — Explorer caps >300-child dirs (visibleChildren helper + "show all" row). test: tests/s2-bigdir.mjs PASS — 5000→300 rows (16.7x fewer), show-all reveals all.
- 2026-06-18 S1 — disk-cached graph reuse (sha sidecar) skips `graphify update`. test: tests/s1-graph-cache.mjs PASS — first_build=612ms, cached_reload=206ms (3.0x), graphify skipped.
