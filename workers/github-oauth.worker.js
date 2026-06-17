/* github-oauth.worker.js — tiny Cloudflare Worker that gives Repo Lens a
 * "Sign in with GitHub" button without putting any secret in the browser.
 *
 * Why a worker at all: GitHub's OAuth code→token exchange requires the OAuth
 * App's client_secret, which a static page (GitHub Pages) can't hold safely,
 * and GitHub supports neither PKCE nor CORS on its token endpoint. So this
 * worker holds the secret and does the exchange server-side. The browser only
 * ever receives the resulting user access token (in a URL fragment), exactly
 * the user's own GitHub permissions — nothing more.
 *
 * ── Routes ───────────────────────────────────────────────────────────────────
 *   GET /gh/login?redirect=<app_url>
 *        → 302 to github.com/login/oauth/authorize (sets a signed state cookie)
 *   GET /gh/callback?code=&state=
 *        → exchanges code for a token, 302 back to <app_url>#gh_token=<token>
 *
 * ── Register an OAuth App ─────────────────────────────────────────────────────
 *   github.com → Settings → Developer settings → OAuth Apps → New OAuth App
 *     Homepage URL:               https://han-oqo.github.io/repo-lens
 *     Authorization callback URL: https://<this-worker-host>/gh/callback
 *   (For the company org with SAML SSO, an org owner may need to approve the App.)
 *
 * ── Deploy (free tier) ────────────────────────────────────────────────────────
 *   npm i -g wrangler
 *   wrangler init repolens-auth        # paste this file as src/index.js
 *   wrangler secret put GH_CLIENT_ID       # the OAuth App client id
 *   wrangler secret put GH_CLIENT_SECRET   # the OAuth App client secret
 *   # set ALLOWED_REDIRECTS below (or as a plain var) to your app origins
 *   wrangler deploy
 *   # Then paste https://<worker-host> into Repo Lens ⚙ → "Auth server URL".
 */

// Comma-separated list of allowed redirect prefixes (CSRF / open-redirect guard).
// Override via a Wrangler [vars] entry of the same name if you prefer.
const DEFAULT_ALLOWED_REDIRECTS = [
  "https://han-oqo.github.io/repo-lens",
  "http://localhost:3000",
];

const SCOPE = "repo read:org"; // user's repos (incl. private) + org membership for SSO
const GH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GH_TOKEN = "https://github.com/login/oauth/access_token";

function allowedRedirects(env) {
  if (env.ALLOWED_REDIRECTS) return env.ALLOWED_REDIRECTS.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_ALLOWED_REDIRECTS;
}
function isAllowed(redirect, env) {
  // Exact origin or a path *under* it — NOT a bare prefix. A bare prefix would let
  // "https://app.example.com.evil.com" pass an "https://app.example.com" check and
  // leak the OAuth token to an attacker's domain.
  return allowedRedirects(env).some((p) => redirect === p || redirect.startsWith(p + "/"));
}
function randHex(n = 16) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64urlEncode(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cb = `${url.origin}/gh/callback`;

    // ── /gh/login ──────────────────────────────────────────────────────────
    if (url.pathname === "/gh/login") {
      const redirect = url.searchParams.get("redirect") || "";
      if (!isAllowed(redirect, env)) return new Response("redirect not allowed", { status: 400 });
      const nonce = randHex();
      const state = b64urlEncode(JSON.stringify({ r: redirect, n: nonce }));
      const auth = new URL(GH_AUTHORIZE);
      auth.searchParams.set("client_id", env.GH_CLIENT_ID);
      auth.searchParams.set("redirect_uri", cb);
      auth.searchParams.set("scope", SCOPE);
      auth.searchParams.set("state", state);
      auth.searchParams.set("allow_signup", "false");
      return new Response(null, {
        status: 302,
        headers: {
          Location: auth.toString(),
          // HttpOnly state cookie scoped to the worker; verified on callback.
          "Set-Cookie": `gh_state=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
        },
      });
    }

    // ── /gh/callback ───────────────────────────────────────────────────────
    if (url.pathname === "/gh/callback") {
      const code = url.searchParams.get("code");
      const stateRaw = url.searchParams.get("state") || "";
      if (!code) return new Response("missing code", { status: 400 });

      let state;
      try {
        state = JSON.parse(b64urlDecode(stateRaw));
      } catch {
        return new Response("bad state", { status: 400 });
      }
      const cookie = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)gh_state=([a-f0-9]+)/);
      if (!cookie || cookie[1] !== state.n) return new Response("state mismatch", { status: 400 });
      if (!isAllowed(state.r, env)) return new Response("redirect not allowed", { status: 400 });

      const tokenRes = await fetch(GH_TOKEN, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GH_CLIENT_ID,
          client_secret: env.GH_CLIENT_SECRET,
          code,
          redirect_uri: cb,
        }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        return new Response("token exchange failed: " + (data.error_description || data.error || "unknown"), { status: 502 });
      }
      // Hand the token to the app via the URL fragment (never sent to a server).
      const back = state.r + (state.r.includes("#") ? "&" : "#") + "gh_token=" + encodeURIComponent(data.access_token);
      return new Response(null, {
        status: 302,
        headers: { Location: back, "Set-Cookie": "gh_state=; Path=/; Max-Age=0" },
      });
    }

    return new Response("Repo Lens auth worker. Routes: /gh/login, /gh/callback", { status: 200 });
  },
};
