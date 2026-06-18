---
description: Implement the next roadmap unit — test-driven (write test, run, record), committed
argument-hint: "[unit ID, e.g. A2 — optional]"
---

You are continuing the Repo Lens build using the roadmap ledger. Do **one** unit, end to end, **test-driven**.

## Steps
0. **Resume check (safe across /clear between units).** Run `git status --short`.
   - Read `docs/ROADMAP.md` and look for a unit marked `[~]` (in progress).
   - **If a `[~]` unit exists:** a previous run was interrupted (e.g. /clear mid-unit).
     Resume THAT unit, not a new one. If the working tree is clean (`git status` empty),
     its code was never committed → redo the Change from scratch. If there are uncommitted
     changes, inspect them and continue from there. Don't pick a new `[ ]` until the `[~]`
     one is finished (or reset it to `[ ]` if abandoning).
   - **If the tree is dirty but no `[~]` unit:** surface the uncommitted changes to the
     user before starting — don't bury them under a new unit.
   - Confirm the active git account will be restored (`hanq-moreh`) per CLAUDE.md.
1. **Read `docs/ROADMAP.md`** (unit definition: Change + Test + Result) and skim `CLAUDE.md`. Look at `tests/helpers.mjs` for the test convention. (The :8099 server may not be running after a fresh session — the test spins up its own, so that's fine; restart :8099 only if you need to verify in the browser.)
2. **Pick the unit:** a resumed `[~]` unit (step 0) wins. Else if `$ARGUMENTS` names an ID, do that; else the first `[ ]` top-to-bottom (skip `[!]`). If none remain, say so and stop.
3. **Announce** the unit ID + title + its **Test** spec, then flip its checkbox to `[~]`.
4. **Implement the Change** — small, focused, matching existing style. If too big, do the first slice and add the rest as a new `[ ]` sub-unit (with its own Test).
5. **Write the test** at `tests/<id>.mjs` per the unit's *Test* line, using `tests/helpers.mjs` (own port + temp data dir; never the :8099 dev server). It must assert the acceptance criteria AND print the **metric** the unit calls for (e.g. before/after timing). Exit 0 = pass.
6. **Run it:** `node tests/<id>.mjs`. Rebuild the frontend first only if `app/`/`components/`/`lib/` changed and the test inspects the built bundle. Show the output.
   - If it fails, fix the implementation (or the test if the test is wrong) and re-run until green. Do not proceed on a red test.
   - If the goal genuinely can't be auto-tested (needs a real browser), write the closest possible check (bundle/source assertion or endpoint smoke) and say explicitly what remains manual.
7. **Record the Result** in the unit (`*Result:* PASS <today> — <metric>`) and append the same to the Changelog. Flip `[~]` → `[x]`. Use today's date from the environment.
8. **Commit + push** (one commit, message starts with the unit ID):
   ```
   git add -A && git commit -m "<ID>: <summary>" -m "test: tests/<id>.mjs <result/metric>" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   gh auth switch --user HAN-oQo && git push origin main && gh auth switch --user hanq-moreh
   ```
   (Never commit `.env` — gitignored, holds the askbot token.)
9. **Report:** what changed, the test + its metric/result, and the **next** pending unit.

## Rules
- One unit per invocation. A unit is only `[x]` with a passing `tests/<id>.mjs` and a recorded Result. No green test → not done.
- Keep context lean — summarize, don't dump files.
- Blocked (needs a decision/credential/real browser the test can't cover)? Flip to `[!]` with a note and tell the user what you need.
- Leave the :8099 dev server running after verifying.

$ARGUMENTS
