// In-memory activity log so the UI can show exactly what the backend is doing
// (clone / scan / graph build / search / ask). Also mirrored to stdout, so on the
// CE node `journalctl -u repolens -f` shows the same stream.
const BUF = [];
const MAX = 200;
let seq = 0;

/** Record one activity line. scope is usually "owner/repo" (or "" for global). */
export function logActivity(msg, scope = "") {
  const line = { id: ++seq, t: Date.now(), scope, msg: String(msg).slice(0, 300) };
  BUF.push(line);
  if (BUF.length > MAX) BUF.shift();
  console.log(`[act]${scope ? " " + scope : ""} ${line.msg}`);
  return line;
}

/** Lines since a given id (for incremental polling); default = last 40. */
export function recentActivity(sinceId = 0, scope = "") {
  let lines = sinceId ? BUF.filter((l) => l.id > sinceId) : BUF.slice(-40);
  if (scope) lines = lines.filter((l) => l.scope === scope || l.scope === "");
  return { lines, lastId: seq };
}
