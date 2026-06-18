// Minimal integration-test helpers for Repo Lens units. No deps — Node fetch +
// child_process. Each unit test spins up its OWN backend on a test port + temp
// data dir (so it never touches the :8099 dev server), exercises /api, asserts
// the unit's acceptance criteria, and prints PASS/FAIL + metrics. Exit 0 = pass.
//
//   node tests/<id>.mjs
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start the backend on a dedicated port + data dir. Returns { base, stop }. */
export function startServer({ port, dataDir, env = {} }) {
  const proc = spawn("node", ["server/server.mjs"], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...env },
    stdio: "ignore",
  });
  return {
    base: `http://localhost:${port}`,
    stop: () => { try { proc.kill("SIGKILL"); } catch {} },
    proc,
  };
}

export async function waitHealthz(base, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await (await fetch(base + "/healthz")).text()) === "ok") return; } catch {}
    await sleep(300);
  }
  throw new Error("server did not come up: " + base);
}

export async function jpost(base, path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
export async function jget(base, path) {
  return (await fetch(base + path)).json();
}

/** Poll /api/graph until ready/error; returns { status, ms }. */
export async function pollGraph(base, repo, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const g = await jget(base, `/api/graph?repo=${encodeURIComponent(repo)}`).catch(() => ({}));
    if (g.status === "ready" || g.status === "error" || g.status === "unavailable") return { status: g.status, ms: Date.now() - t0, graph: g };
    await sleep(200);
  }
  return { status: "timeout", ms: Date.now() - t0 };
}

export function freshDir(p) { try { rmSync(p, { recursive: true, force: true }); } catch {} return p; }

/** Tiny assert + report. Call done() at the end. */
export function harness(id) {
  const checks = [];
  return {
    check(name, ok, detail = "") { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); },
    done() {
      const failed = checks.filter((c) => !c.ok);
      console.log(`\n[${id}] ${failed.length ? "FAIL" : "PASS"} (${checks.length - failed.length}/${checks.length})`);
      process.exit(failed.length ? 1 : 0);
    },
  };
}
