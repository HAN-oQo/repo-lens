# ✦ Repo Lens

Paste a GitHub link and read, search, and understand any repository in a VSCode-like
UI — file tree, code, README, an **import dependency graph**, and an **AI panel**
that answers questions grounded in the repo. 100% client-side, deployed as a static
site on GitHub Pages.

**Live:** https://han-oqo.github.io/repo-lens

## What it does

- **Top bar** — paste `owner/repo`, a `https://github.com/owner/repo` URL, or a
  `.../tree/<branch>` link, then **Load**.
- **Left (Explorer / Search)** — browse the file tree; click a file to open it.
- **Center (tabs)** — rendered **README**, source files in a read-only **Monaco**
  editor (the actual VSCode editor), and a **🕸 Knowledge Graph**.
- **Knowledge Graph** — nodes are source files, edges are `import` / `require`
  relationships (JS/TS + Python relative imports resolved client-side). Color = top
  folder, size = connection count. Hover to highlight neighbors, click to open the file.
- **Right (Ask Repo Lens)** — the "big version" of the blog's `ask.js` widget,
  grounded in the repo (file tree + README + the open file). Quick actions: *Explain
  file*, *Summarize repo*, *Trace flow*. File paths in answers are clickable. Multi-turn,
  bilingual (EN/한), streaming, citations.

## Architecture (no backend)

| Concern | How |
| --- | --- |
| File tree | `GET /repos/:o/:r/git/trees/:branch?recursive=1` — **one** API call |
| File contents | `raw.githubusercontent.com` CDN — **doesn't** consume the REST rate limit |
| Private repos / rate limit | **Sign in with GitHub** (OAuth) or paste a token (⚙); token stored only in `localStorage` |
| Caching | IndexedDB, keyed by `repo@branch:path` |
| Import graph | regex extraction + relative-path resolution, in the browser |
| Editor | `@monaco-editor/react` (loads Monaco from CDN) |
| AI | multi-provider `ask.js` port — default is a shared bot endpoint; or bring your own Claude / OpenAI / Gemini key (stored only in `localStorage`) |

The default AI bot accepts requests only from the deployed site's origin
(`https://han-oqo.github.io`). On `localhost`, choose a *"your API key"* provider in
the Ask panel's settings.

## Private repos — "Sign in with GitHub"

GitHub's OAuth token exchange needs a client secret, which a static page can't hold,
so sign-in uses one tiny serverless endpoint: **`workers/github-oauth.worker.js`**
(a Cloudflare Worker, ~deploy like the blog's ask proxy). It holds the OAuth App
secret and hands the browser only the user's own access token (via URL fragment).

1. Register an **OAuth App** (Settings → Developer settings → OAuth Apps). Callback
   URL = `https://<worker-host>/gh/callback`.
2. Deploy the worker (`wrangler secret put GH_CLIENT_ID` / `GH_CLIENT_SECRET`; set
   `ALLOWED_REDIRECTS`). See the header comment in the worker file.
3. In Repo Lens ⚙ → paste the worker URL → **Sign in with GitHub**.

No worker? The ⚙ panel also accepts a Personal Access Token (zero backend).

## Develop

```bash
npm install --legacy-peer-deps
npm run dev      # http://localhost:3000
npm run build    # static export to ./out
```

Deployed automatically by `.github/workflows/pages.yml` on every push to `main`.

## Stack

Next.js (App Router, static export) · TypeScript · Monaco · react-markdown ·
react-force-graph-2d · idb.
