---
description: Implement the next unit from docs/ROADMAP.md (small, verified, committed)
argument-hint: "[unit ID, e.g. A2 — optional]"
---

You are continuing the Repo Lens build using the roadmap ledger. Do **one** unit, end to end.

## Steps
1. **Read `docs/ROADMAP.md`** (the protocol + units). Also skim `CLAUDE.md` for repo conventions.
2. **Pick the unit:**
   - If arguments were given (`$ARGUMENTS`), do that unit ID.
   - Otherwise pick the **first unit marked `[ ]`** top-to-bottom, skipping any `[!]` blocked.
   - If none are left, say so and stop.
3. **Announce** the chosen unit ID + title + its acceptance criteria, then flip its checkbox to `[~]` in `docs/ROADMAP.md`.
4. **Implement it** — small and focused, matching existing code style. Only touch what the unit needs. If the unit turns out to be too big, split it: do the first slice, and add the remainder as a new `[ ]` sub-unit in the roadmap.
5. **Verify** against the acceptance criteria using the **Test loop** in ROADMAP.md:
   - Rebuild the frontend only if `app/`, `components/`, or `lib/` changed.
   - Restart the backend on :8099 and `curl` the relevant `/api/*` (or check the built asset) to prove the criteria. Show the evidence.
   - If you cannot verify (e.g. needs the browser), say exactly what was and wasn't verified.
6. **Mark done:** flip `[~]` → `[x]` and append a line to the Changelog: `- <today> <ID> — <what> (verified: <how>)`. Use today's date from the environment context.
7. **Commit + push** (one commit for this unit, message starting with the unit ID):
   ```
   git add -A && git commit -m "<ID>: <summary>" -m "...details..." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   gh auth switch --user HAN-oQo && git push origin main && gh auth switch --user hanq-moreh
   ```
   (Do NOT commit `.env` — it's gitignored and holds the askbot token.)
8. **Report:** what you did, how you verified, and the **next** pending unit so the user knows what `/next` will do next.

## Rules
- One unit per invocation. Don't run ahead.
- Keep context lean — don't dump large file contents; summarize.
- If blocked (needs a decision, credential, or the browser), flip the unit to `[!]` with a note explaining the blocker, and tell the user what you need.
- The backend test server lives on :8099 and reads `.env` (token already set). Leave it running after verifying.

$ARGUMENTS
