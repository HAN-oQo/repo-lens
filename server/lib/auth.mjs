// Auth gate + rate limiting for the public (login-gated) deployment.
// AUTH_REQUIRED=1 → every /api call must carry a valid GitHub token (the user's
// OAuth token). Private single-node deploys leave it unset (single-user trust).

export const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1";

const userCache = new Map(); // token -> { login, exp }
const USER_TTL = 10 * 60 * 1000;

/** Returns the GitHub login for a token, or null. Cached to avoid per-request calls. */
export async function validateUser(token) {
  const tk = (token || "").trim();
  if (!tk) return null;
  const c = userCache.get(tk);
  if (c && c.exp > Date.now()) return c.login;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tk}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const login = j.login || "?";
    userCache.set(tk, { login, exp: Date.now() + USER_TTL });
    return login;
  } catch {
    return null;
  }
}

// sliding-window per-key rate limiter (in-memory)
const hits = new Map(); // key -> number[] timestamps
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => t > now - windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
