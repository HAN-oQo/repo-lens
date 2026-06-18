---
description: Turn a set of goals into a test-driven roadmap (docs/ROADMAP.md) where every unit = Change + Test + Result
argument-hint: "<goals / feature description to break down>"
---

Create or extend a **test-driven roadmap** at `docs/ROADMAP.md` from the goals in `$ARGUMENTS` (or, if empty, ask the user for the goals). Do NOT implement features here — only produce the plan. This is the reusable structure the `/next` loop consumes.

## The unit contract (non-negotiable)
Break the work into **small units**, each completable in one focused change. Every unit MUST be written as:
- **`[ ] <ID> — <Title>.`** one-line *Change* (what to implement).
- **`*Test:*`** a single runnable test at `tests/<id>.mjs` (lowercased ID) that asserts the unit's goal and prints a **metric** when relevant (speed before/after, counts, sizes). Tests use `tests/helpers.mjs` — spin up an own backend on a test port + temp data dir, never the :8099 dev server. Exit 0 = pass.
- **`*Result:*`** `(pending)` — filled by `/next` on completion with `PASS/FAIL <date> — <metric>`.
- A unit is DONE only when its test is green and Result is recorded. If a goal needs a real browser, specify the closest automatable check (bundle/source assertion or endpoint smoke) plus what stays manual.

IDs: one letter per goal group + a number (e.g. `S1`, `A2`, `U3`). Order units so earlier ones unblock later ones.

## File shape (match the existing `docs/ROADMAP.md`)
Keep/!create these sections:
1. Title + "source of truth" note.
2. **A unit is DONE only when: implemented → tested → run → result recorded** (the contract above).
3. **Protocol** (how `/next` picks/implements/tests/records/commits; status legend `[ ] [~] [x] [!]`).
4. **Test loop** (the project's build/serve/test commands — copy from the current file).
5. **Goals** as `##` sections, each a checklist of units in the contract format.
6. **Backlog** + **Changelog** (most recent first; `/next` appends here).

## Procedure
1. If `docs/ROADMAP.md` exists, read it and **extend** it (don't clobber done `[x]` units or the Changelog). Otherwise create it.
2. Restate the goals as `##` groups; write each unit per the contract. Confirm the breakdown with the user if the scope is ambiguous.
3. Ensure `tests/helpers.mjs` exists (create the minimal harness if missing — own-port server, fetch helpers, `harness(id)` with PASS/FAIL + exit code).
4. Do NOT write feature code or unit tests now — those are `/next`'s job. You may scaffold `tests/helpers.mjs` only.
5. Commit the roadmap (and helpers if new). Report the unit list and what `/next` will pick first.

$ARGUMENTS
