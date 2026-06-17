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
2. **Internal tool → `repolens.ce.moreh.dev`** (Docker + CE ingress, VPN-only). basePath root, "Sign in with GitHub" via the bundled OAuth server. Full guide in `DEPLOY.md`.

## "Deploy it" runbook (for an automated run)

**Public demo (Pages):** commit, then push `main` to `HAN-oQo/repo-lens` — CI does the rest.
```bash
gh auth switch --user HAN-oQo     # repo lives under HAN-oQo, not the default hanq-moreh
git add -A && git commit -m "…"   # commit msg ends with the Co-Authored-By trailer
git push origin main              # triggers .github/workflows/pages.yml
gh run watch --repo HAN-oQo/repo-lens
gh auth switch --user hanq-moreh  # restore the default active account
```

**Internal (CE):** prerequisites the human supplies once — an OAuth App
(`client_id`/`secret`, callback `https://repolens.ce.moreh.dev/gh/callback`), a
`.env` (from `.env.example`), a Cloudflare DNS record + CE ingress/TLS for the host,
and adding `https://repolens.ce.moreh.dev` to askbot's CORS allowlist.
```bash
cp .env.example .env              # fill GH_CLIENT_ID / GH_CLIENT_SECRET
scripts/repolens.sh image         # build the container (BASE_PATH= , OAUTH base baked)
scripts/repolens.sh run           # local smoke test of the image
# then push the image to the CE registry and roll the Deployment behind the ingress.
```
Local smoke without Docker: `scripts/repolens.sh build-ce && scripts/repolens.sh serve`.

## Before every deploy (security — keep this up)
- `scripts/repolens.sh audit` (or `/security-review`). See `SECURITY.md`.
- Verify the OAuth redirect allowlist is exact-origin (`r===p || startsWith(p+"/")`) — never a bare prefix (open-redirect → token theft).
- Keep the internal deploy behind VPN / ingress allowlist / Cloudflare Access. Never commit `.env`.

## Conventions
- `npm install` needs `--legacy-peer-deps` (React 19 × react-force-graph).
- GitHub token (OAuth or PAT) lives only in `localStorage` (`repolens-gh-token`); all fetches read it.
- AI reuses the blog `ask.js` providers + `ask-ai-*` localStorage keys; default bot is origin-gated to the deployed site.
