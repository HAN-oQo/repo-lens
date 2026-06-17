# Security notes — Repo Lens

Repo Lens is a client-side reader. It holds a user's GitHub token in their browser
and (for the self-hosted build) runs one small OAuth endpoint. This file records the
threat model, the review findings, and the ongoing process.

## Threat model

| Asset | Where it lives | Exposure |
| --- | --- | --- |
| GitHub access token | the user's `localStorage` (`repolens-gh-token`) | stolen only via XSS on our origin, or a malicious browser extension |
| OAuth App `client_secret` | server-side only (worker / Node env) | never in the browser or the image |
| Private repo source | fetched into the browser; sent to the AI provider **only when the user asks** | the Ask panel warns before each send |

## Review findings

**Fixed**
- **Open redirect → token theft (high).** The OAuth redirect allowlist used a bare
  `startsWith(prefix)` check, so `https://app.example.com.evil.com` passed an
  `https://app.example.com` allowlist and could receive the token in the URL fragment.
  Fixed to `r === p || r.startsWith(p + "/")` in both `server/server.mjs` and
  `workers/github-oauth.worker.js`. (Verified: attack → 400, legit → 302.)
- **Static path traversal (hardening).** The Node static handler normalizes, strips
  leading `../`, and then verifies the resolved path stays inside `OUT_DIR` (403
  otherwise). Verified: `/../../etc/passwd` does not escape.

**By design / accepted**
- **XSS surface.** AI answers are rendered through `lib/md.ts`, which HTML-escapes the
  input first and only emits a whitelist of tags + http/mailto links (file links carry
  an escaped `data-path`). READMEs render via `react-markdown` (no `rehype-raw`; raw
  HTML and `javascript:` URLs are stripped). No `eval`/`new Function`.
- **OAuth state/CSRF.** A random nonce is set as an `HttpOnly; Secure; SameSite=Lax`
  cookie and matched against the signed `state` on callback; the redirect target is
  re-validated against the allowlist on callback.
- **Scope.** The OAuth App requests `repo read:org`. `repo` is read+write (OAuth Apps
  have no read-only repo scope). The app only ever issues `GET`s, but for least
  privilege prefer a **GitHub App** (per-repo, read-only Contents/Metadata).
- **Token in URL fragment.** The token returns in `#gh_token=…`; the app consumes it
  and `history.replaceState`s it away. Fragments are never sent to servers.

**Known / low-risk**
- `npm audit` flags `postcss < 8.5.10` (XSS when stringifying untrusted CSS), pulled in
  transitively by Next's build toolchain. We do not run PostCSS over untrusted CSS, so
  impact is negligible; it resolves when Next bumps the dep. Tracked by Dependabot.
- Monaco is loaded from a CDN by `@monaco-editor/react`. For a stricter supply-chain
  posture, self-host Monaco. Acceptable for an internal tool over HTTPS.

## Ongoing process ("꾸준히")

- **Dependabot** (`.github/dependabot.yml`) opens weekly PRs for npm + GitHub Actions.
- **Before every deploy** run `/security-review` (Claude Code) or at least
  `npm audit --omit=dev`; see the checklist in `CLAUDE.md` → Deployment.
- Keep it **internal** (VPN / ingress allowlist / Cloudflare Access). Don't expose a
  private-source reader on a public IP.
