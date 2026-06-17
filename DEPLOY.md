# Deploying Repo Lens v2 on the CE-master CPU node (self-contained, private)

Goal: an internal team tool that, from a single container on the CE-master node,
clones a repo, serves the UI, builds a **graphify** symbol graph, does **full-text
search**, and answers questions with **GraphRAG** — reached only via SSH tunnel,
nothing public.

## Architecture (one container, localhost-only)

```
your laptop ──SSH tunnel──> CE-master  ──127.0.0.1:8080──> repolens container
  ssh -L 8080:localhost:8080 ce-master                       ├─ static app (./out)
  open http://localhost:8080                                 ├─ /gh/* OAuth (http localhost callback)
                                                             ├─ git clone (cached, /data)
                                                             ├─ ripgrep full-text search
                                                             ├─ graphify symbol graph (bg, cached)
                                                             └─ GraphRAG → LLM (askbot or Anthropic)
```

Because it's localhost-only: OAuth callback is `http://localhost:8080/gh/callback`
(GitHub allows http for localhost — no TLS/DNS), and the AI call is server→LLM
(no browser CORS).

## 1. Register a GitHub OAuth App
GitHub → Settings → Developer settings → OAuth Apps → New.
- Homepage: `http://localhost:8080`
- **Authorization callback URL: `http://localhost:8080/gh/callback`**
- Note Client ID + secret. (For `aiandlabs` SSO, an owner approves the App once.)

## 2. Configure + build + run
```bash
cp .env.example .env          # fill GH_CLIENT_ID/SECRET + ANTHROPIC_API_KEY (or ASK_URL)
scripts/repolens.sh image     # build node+git+ripgrep+graphify image
scripts/repolens.sh run       # docker run -p 127.0.0.1:8080:8080 -v repolens-data:/data … (reads .env)
```
Health: `curl localhost:8080/healthz` → `ok`.

Without Docker (native on the node): `scripts/repolens.sh build-ce && scripts/repolens.sh serve`
(needs `git`, `ripgrep`, and `uv tool install graphifyy` on the node).

## 3. Use it
```bash
ssh -L 8080:localhost:8080 <ce-master>     # from your laptop
# open http://localhost:8080 → ⚙ Sign in with GitHub → paste a repo → Load
```
Tree/README/search/files are instant; the graph builds in the background; Ask uses
GraphRAG once you've signed in (the token is forwarded for cloning private repos).

## Notes
- Data (clones + graphify caches) lives in the `repolens-data` volume → fast repeat loads.
- LLM: set `ANTHROPIC_API_KEY` (direct) **or** `ASK_URL` (your askbot gateway) in `.env`.
- Public GitHub Pages demo (`han-oqo.github.io/repo-lens`) stays browser-only — no backend, no private repos there.
- Security model in `SECURITY.md` (localhost bind, clone allowlist, token in env only).
