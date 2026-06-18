// Shared backend utilities: data dir, safe subprocess exec, git auth env,
// host allowlist, path containment.
import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";

export const DATA_DIR = resolve(process.env.DATA_DIR || "./data");
export const CLONE_ALLOWED_HOSTS = (process.env.CLONE_ALLOWED_HOSTS || "github.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

const NAME = /^[A-Za-z0-9._-]+$/;
/** owner/repo are used in filesystem paths + shell — validate strictly. */
export function validName(s) {
  return typeof s === "string" && NAME.test(s) && s !== "." && s !== "..";
}

export function hostAllowed(host) {
  return CLONE_ALLOWED_HOSTS.includes(host);
}

/** git config (auth header) passed via env, never argv — keeps the token out of `ps`. */
export function gitEnv(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const tk = (token || process.env.GITHUB_SERVICE_TOKEN || "").trim();
  if (tk) {
    const basic = Buffer.from(`x-access-token:${tk}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
  }
  return env;
}

// Tools (rg, git, graphify, uv) may live outside the minimal PATH a daemon
// inherits (e.g. Homebrew's /opt/homebrew/bin). Augment PATH for every spawn.
const EXTRA_PATH = [
  `${process.env.HOME || ""}/.local/bin`, "/root/.local/bin",
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin",
].filter(Boolean);
function withPath(env) {
  const e = { ...(env || process.env) };
  const have = (e.PATH || "").split(":");
  e.PATH = [...have, ...EXTRA_PATH.filter((p) => !have.includes(p))].filter(Boolean).join(":");
  return e;
}

/** Run a command with a timeout and captured output. Never throws on the token.
 *  Optional onLine(text, stream) fires per output line as it arrives (for live
 *  progress streaming, e.g. graphify). */
export function run(cmd, args, { cwd, env, timeout = 120000, maxBuffer = 64 * 1024 * 1024, onLine } = {}) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { cwd, env: withPath(env) });
    let out = Buffer.alloc(0);
    let err = "";
    let killed = false;
    let sbuf = "";
    const feed = (chunk, stream) => {
      if (!onLine) return;
      sbuf += chunk;
      let nl;
      while ((nl = sbuf.indexOf("\n")) >= 0) {
        const line = sbuf.slice(0, nl).trim();
        sbuf = sbuf.slice(nl + 1);
        if (line) { try { onLine(line, stream); } catch {} }
      }
    };
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => {
      if (out.length < maxBuffer) out = Buffer.concat([out, d]);
      feed(d.toString(), "out");
    });
    child.stderr.on("data", (d) => {
      if (err.length < 1_000_000) err += d.toString();
      feed(d.toString(), "err");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolveP({ code: -1, stdout: out, stderr: String(e), timedOut: killed });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveP({ code, stdout: out, stderr: err, timedOut: killed });
    });
  });
}

/** Resolve `rel` inside `root`; return null if it would escape. */
export function containedPath(root, rel) {
  const full = resolve(root, "." + sep + rel.replace(/^[/\\]+/, ""));
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
