# Deploying Repo Lens internally at `repolens.ce.moreh.dev`

Goal: an internal team tool with one-click **Sign in with GitHub**, served from one
container on the CE cluster, behind the company network/VPN — the same shape as
`askbot.ce.moreh.dev`.

## Architecture

```
Browser ──https──> CE ingress (TLS, repolens.ce.moreh.dev) ──> repo-lens container :8080
                                                                  ├─ serves the static app (./out)
                                                                  └─ /gh/login, /gh/callback (OAuth)
GitHub API / raw.githubusercontent.com  ←── browser (with the user's token)
askbot.ce.moreh.dev                     ←── browser (AI; add this origin to its CORS allowlist)
```

One process serves the app **and** the OAuth exchange on the same origin, so there's
no cross-origin/CORS to manage for sign-in.

## 1. Register a GitHub OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
- **Homepage URL:** `https://repolens.ce.moreh.dev`
- **Authorization callback URL:** `https://repolens.ce.moreh.dev/gh/callback`
- Note the **Client ID** and generate a **Client secret**.
- If the `aiandlabs` org enforces SAML SSO, an org owner approves the App once.

## 2. Build & run the container

```bash
docker build \
  --build-arg BASE_PATH= \
  --build-arg NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev \
  -t repolens:latest .

docker run -d --name repolens -p 8080:8080 \
  -e GH_CLIENT_ID=<client id> \
  -e GH_CLIENT_SECRET=<client secret> \
  -e ALLOWED_REDIRECTS=https://repolens.ce.moreh.dev,http://localhost:3000 \
  repolens:latest
```

- `BASE_PATH=` (empty) → app is served at the domain root (not `/repo-lens`).
- `NEXT_PUBLIC_OAUTH_BASE` is **baked at build time** → the Sign-in button works with
  zero user config.
- Secrets are **runtime-only** (never in the image).
- Health check: `GET /healthz` → `ok`.

### Without Docker
```bash
BASE_PATH= NEXT_PUBLIC_OAUTH_BASE=https://repolens.ce.moreh.dev npm run build
GH_CLIENT_ID=… GH_CLIENT_SECRET=… ALLOWED_REDIRECTS=https://repolens.ce.moreh.dev npm run serve
```

## 3. DNS + ingress + TLS (same as askbot)

- Cloudflare (moreh.dev zone): add `repolens.ce.moreh.dev` → the CE edge (A record, or
  CNAME to the existing ingress host).
- CE ingress: route host `repolens.ce.moreh.dev` → the container `:8080`, with a
  Let's Encrypt cert (cert-manager) for that host. **TLS is required** — GitHub OAuth
  rejects non-HTTPS callbacks.

## 4. Keep it internal

It reads private source and holds GitHub tokens in users' browsers — don't expose it
openly. Pick one:
- ingress **source-IP allowlist** / VPN-only (office + VPN ranges), or
- Cloudflare **proxied (orange) + Access (Zero Trust)** in front for company-SSO gating.

## 5. Let the AI work

The Ask panel calls `askbot.ce.moreh.dev`. Add **`https://repolens.ce.moreh.dev`** to
askbot's CORS/Origin allowlist (it currently allows `https://han-oqo.github.io`).

## Updating

Rebuild the image on a new commit and roll the container. The GitHub Pages public demo
(`han-oqo.github.io/repo-lens`) keeps deploying independently from `.github/workflows/pages.yml`.
