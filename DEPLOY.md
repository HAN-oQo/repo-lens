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

## Public, login-gated on the CE cluster (askbot pattern)

If you want a stable public host (`repolens.ce.moreh.dev`) instead of an SSH tunnel,
deploy it the **same way moreh-dev/ce-training runs askbot**: the server is a host
systemd service on ce-master, exposed through the shared istio gateway with a
Gateway API **HTTPRoute** — no registry, no cert-manager, no Ingress (TLS terminates
at the edge). It stays safe because the app self-gates (GitHub login +
`AUTH_REQUIRED=1`), exactly like askbot's `ACCESS_TOKEN`+CORS.

Files: `deploy/repolens.service` (host unit), `deploy/k8s/repolens.yaml`
(Service + EndpointSlice → node IP + HTTPRoute on `istio-system/public-gw`),
`deploy/k8s/apply.sh`. Full step-by-step: **`docs/repo-lens-ce-deploy.html`**.

```bash
# on ce-master
git clone https://github.com/HAN-oQo/repo-lens /srv/repolens/repo && cd /srv/repolens/repo
docker build -t repolens:latest \
  --build-arg NEXT_PUBLIC_API_BASE=https://repolens.ce.moreh.dev \
  --build-arg NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev .
# fill /srv/repolens/repolens.env (GH_CLIENT_ID/SECRET, AUTH_REQUIRED=1, ASK_URL or ANTHROPIC_API_KEY)
sudo cp deploy/repolens.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now repolens
deploy/k8s/apply.sh                       # public route on the shared gateway
# flip the public Pages demo to this backend:
gh variable set REPOLENS_API_BASE   --repo HAN-oQo/repo-lens --body https://repolens.ce.moreh.dev
gh variable set REPOLENS_OAUTH_BASE --repo HAN-oQo/repo-lens --body https://repolens.ce.moreh.dev
```
Until those repo variables are set, the public Pages demo stays browser-only (v1).
(`fly.toml` remains as an alternative throwaway-host option, but the CE path is free.)

## Notes
- Data (clones + graphify caches) lives in the `repolens-data` volume → fast repeat loads.
- LLM: set `ANTHROPIC_API_KEY` (direct) **or** `ASK_URL` (your askbot gateway) in `.env`.
- Public GitHub Pages demo (`han-oqo.github.io/repo-lens`) stays browser-only — no backend, no private repos there.
- Security model in `SECURITY.md` (localhost bind, clone allowlist, token in env only).
