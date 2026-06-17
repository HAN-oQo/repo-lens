@AGENTS.md

# Repo Lens — project guide

VSCode-like GitHub repo reader: paste a link → file tree (left), README/Monaco code +
import **knowledge graph** (center), AI **Ask** panel grounded in the repo (right).
100% client-side. See `README.md`, `DEPLOY.md`, `SECURITY.md` for detail.

## Layout
- `app/page.tsx` — the single client page (all state lives here).
- `components/` — Explorer, CodeView (Monaco), MarkdownView, GraphView, AskPanel.
- `lib/` — `github.ts` (fetch + OAuth helpers), `imports.ts` (graph), `tree.ts`, `lang.ts`, `md.ts`.
- `server/server.mjs` — self-host server: serves `./out` + GitHub OAuth (`/gh/login`, `/gh/callback`).
- `workers/github-oauth.worker.js` — same OAuth flow as a Cloudflare Worker (alternative to the Node server).
- `scripts/repolens.sh` — one entrypoint for build/serve/image/run/audit.

## Two deploy targets
1. **Public demo → GitHub Pages** at `https://han-oqo.github.io/repo-lens` (repo `HAN-oQo/repo-lens`).
   Auto-deploys on push to `main` via `.github/workflows/pages.yml`. basePath `/repo-lens`. No private-repo OAuth here (PAT only).
2. **Internal tool → CE-master CPU node, localhost-only** (Docker, reached via SSH tunnel; NEVER public — see [[ce-deploy-preference]]). This is the **v2 analysis backend**: `server/` clones the repo, serves the app + OAuth, builds a **graphify** symbol graph, does **ripgrep full-text search**, and answers via **GraphRAG**. Frontend uses it when `NEXT_PUBLIC_API_BASE` is set (else v1 browser fallback). Full guide in `DEPLOY.md`.

### v2 backend map
- `server/server.mjs` mounts `/api/*` (`api.mjs`) + serves `./out` + `/gh/*` OAuth.
- `server/lib/`: `util.mjs` (spawn/PATH/token-env/containment), `repo.mjs` (clone/tree/file), `search.mjs` (rg → git-grep fallback), `graphify.mjs` (`graphify update` → graph.json → GraphData), `graph.mjs` (bg build queue + state), `graphrag.mjs` (retrieve + LLM).
- Frontend: `lib/api.ts` (backend client), graph/search/ask wired in `app/page.tsx` + `components/{GraphView,AskPanel}.tsx`.

## "Deploy it" runbook (for an automated run)

**Public demo (Pages):** commit, then push `main` to `HAN-oQo/repo-lens` — CI does the rest.
```bash
gh auth switch --user HAN-oQo     # repo lives under HAN-oQo, not the default hanq-moreh
git add -A && git commit -m "…"   # commit msg ends with the Co-Authored-By trailer
git push origin main              # triggers .github/workflows/pages.yml
gh run watch --repo HAN-oQo/repo-lens
gh auth switch --user hanq-moreh  # restore the default active account
```

**Internal (CE node, v2):** human supplies once — an OAuth App (callback
`http://localhost:8080/gh/callback`) and a `.env` (from `.env.example`) with
`GH_CLIENT_ID/SECRET` + `ANTHROPIC_API_KEY` (or `ASK_URL`). Then on the node:
```bash
cp .env.example .env
scripts/repolens.sh image     # node + git + ripgrep + graphify image
scripts/repolens.sh run       # -p 127.0.0.1:8080:8080 -v repolens-data:/data (localhost ONLY)
# reach it: ssh -L 8080:localhost:8080 <ce-master> → http://localhost:8080
```
Native (no Docker): needs `git`, `ripgrep`, `uv tool install graphifyy`, then
`scripts/repolens.sh build-ce && scripts/repolens.sh serve`. Full guide: `DEPLOY.md`.

## Before every deploy (security — keep this up)
- `scripts/repolens.sh audit` (or `/security-review`). See `SECURITY.md`.
- Verify the OAuth redirect allowlist is exact-origin (`r===p || startsWith(p+"/")`) — never a bare prefix (open-redirect → token theft).
- Keep the internal deploy behind VPN / ingress allowlist / Cloudflare Access. Never commit `.env`.

## Conventions
- `npm install` needs `--legacy-peer-deps` (React 19 × react-force-graph).
- GitHub token (OAuth or PAT) lives only in `localStorage` (`repolens-gh-token`); all fetches read it.
- AI reuses the blog `ask.js` providers + `ask-ai-*` localStorage keys; default bot is origin-gated to the deployed site.
