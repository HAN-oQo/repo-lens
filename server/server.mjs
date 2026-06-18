/* server.mjs — single, dependency-free Node server for the self-hosted deploy.
 *
 * Serves the static build (./out) AND handles GitHub OAuth on the SAME origin
 * (e.g. https://repolens.ce.moreh.dev). One process, one port — front it with
 * your CE ingress for TLS, exactly like askbot.
 *
 *   GET /gh/login?redirect=<app_url>  → 302 to GitHub authorize (state cookie)
 *   GET /gh/callback?code=&state=     → exchange (server-side secret), 302 back
 *                                       to <app_url>#gh_token=<token>
 *   everything else                   → static file from OUT_DIR (SPA fallback)
 *
 * Runtime env (NOT baked into the image — pass at deploy time):
 *   GH_CLIENT_ID, GH_CLIENT_SECRET   — the OAuth App credentials
 *   ALLOWED_REDIRECTS                — comma list, e.g.
 *                                      https://repolens.ce.moreh.dev,http://localhost:3000
 *   PORT (default 8080), OUT_DIR (default ./out)
 *
 * Note: NEXT_PUBLIC_OAUTH_BASE and BASE_PATH are BUILD-time (baked into ./out),
 * see the Dockerfile / DEPLOY.md.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { handleApi } from "./api.mjs";

const PORT = Number(process.env.PORT || 8080);
const OUT = process.env.OUT_DIR || "./out";
const CLIENT_ID = process.env.GH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GH_CLIENT_SECRET || "";
const ALLOWED = (process.env.ALLOWED_REDIRECTS || "http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const SCOPE = "repo read:org";

const GH_AUTHORIZE = "https://github.com/login/oauth/authorize";
const GH_TOKEN = "https://github.com/login/oauth/access_token";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
};

// Exact origin or a path *under* it. NOT a bare prefix — a bare prefix would let
// "https://app.example.com.evil.com" pass the "https://app.example.com" check and
// leak the OAuth token to an attacker's site.
const isAllowed = (r) => ALLOWED.some((p) => r === p || r.startsWith(p + "/"));
const b64urlEnc = (s) => Buffer.from(s).toString("base64url");
const b64urlDec = (s) => Buffer.from(s, "base64url").toString("utf8");

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

async function serveStatic(req, res, pathname) {
  // normalize + prevent path traversal
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const filePath = join(OUT, safe);
  // Defense in depth: never serve anything outside OUT.
  const root = resolve(OUT);
  if (filePath !== root && !resolve(filePath).startsWith(root + sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }
  try {
    const body = await readFile(filePath);
    sendFile(res, filePath, body);
  } catch {
    // SPA fallback: serve index.html for unknown non-asset routes
    if (!/\.[a-z0-9]+$/i.test(safe)) {
      try {
        const body = await readFile(join(OUT, "index.html"));
        return sendFile(res, "index.html", body, 200);
      } catch { /* fall through */ }
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function sendFile(res, filePath, body, status = 200) {
  const ext = "." + (filePath.split(".").pop() || "");
  const type = MIME[ext.toLowerCase()] || "application/octet-stream";
  // _next assets: Turbopack chunk names aren't always content-hashed, so
  // "immutable" can pin a stale chunk in the browser across rebuilds. Revalidate
  // instead (cheap for an internal tool; avoids "my fix isn't showing up").
  const cache = "no-cache";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": cache });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const p = url.pathname;

    if (p === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }

    // analysis backend
    if (p.startsWith("/api/")) {
      // CORS: the API is reached cross-origin both locally (127.0.0.1 vs localhost,
      // or :3000 dev) and by the public Pages demo → CE backend. It's safe to
      // reflect the Origin because the API is gated by the GitHub token in the
      // x-github-token header (a foreign site can't read repo-lens's localStorage)
      // and by AUTH_REQUIRED when public. setHeader (not writeHead) so handleApi's
      // own writeHead keeps these.
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "content-type, x-github-token");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
      await handleApi(req, res, url);
      return;
    }

    // ── /gh/login ──────────────────────────────────────────────────────────
    if (p === "/gh/login") {
      if (!CLIENT_ID) { res.writeHead(500); return res.end("GH_CLIENT_ID not set"); }
      const target = url.searchParams.get("redirect") || "";
      if (!isAllowed(target)) { res.writeHead(400); return res.end("redirect not allowed"); }
      const nonce = randomBytes(16).toString("hex");
      const state = b64urlEnc(JSON.stringify({ r: target, n: nonce }));
      const cb = `${url.origin}/gh/callback`;
      const auth = new URL(GH_AUTHORIZE);
      auth.searchParams.set("client_id", CLIENT_ID);
      auth.searchParams.set("redirect_uri", cb);
      auth.searchParams.set("scope", SCOPE);
      auth.searchParams.set("state", state);
      auth.searchParams.set("allow_signup", "false");
      return redirect(res, auth.toString(), {
        "Set-Cookie": `gh_state=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      });
    }

    // ── /gh/callback ───────────────────────────────────────────────────────
    if (p === "/gh/callback") {
      const code = url.searchParams.get("code");
      const stateRaw = url.searchParams.get("state") || "";
      if (!code) { res.writeHead(400); return res.end("missing code"); }
      let state;
      try { state = JSON.parse(b64urlDec(stateRaw)); }
      catch { res.writeHead(400); return res.end("bad state"); }
      const m = (req.headers.cookie || "").match(/(?:^|;\s*)gh_state=([a-f0-9]+)/);
      if (!m || m[1] !== state.n) { res.writeHead(400); return res.end("state mismatch"); }
      if (!isAllowed(state.r)) { res.writeHead(400); return res.end("redirect not allowed"); }

      const cb = `${url.origin}/gh/callback`;
      const tokenRes = await fetch(GH_TOKEN, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, redirect_uri: cb }),
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        res.writeHead(502);
        return res.end("token exchange failed: " + (data.error_description || data.error || "unknown"));
      }
      const back = state.r + (state.r.includes("#") ? "&" : "#") + "gh_token=" + encodeURIComponent(data.access_token);
      return redirect(res, back, { "Set-Cookie": "gh_state=; Path=/; Max-Age=0" });
    }

    // ── static ───────────────────────────────────────────────────────────────
    return serveStatic(req, res, p);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("server error: " + (e?.message || e));
  }
});

server.listen(PORT, () => {
  console.log(`Repo Lens serving ${OUT} on :${PORT}  (OAuth ${CLIENT_ID ? "enabled" : "DISABLED — set GH_CLIENT_ID"})`);
  console.log(`allowed redirects: ${ALLOWED.join(", ")}`);
});
