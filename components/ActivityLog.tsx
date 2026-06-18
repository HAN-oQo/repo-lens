"use client";

import { useEffect, useRef, useState } from "react";
import { apiActivity, hasBackend, type ActivityLine } from "@/lib/api";
import type { RepoRef } from "@/lib/types";

/** Floating panel that streams the backend's activity log (clone / scan / graph /
 *  search / ask). Polls /api/activity while `live`; stays visible while `open`. */
export default function ActivityLog({
  open,
  live,
  repo,
  onClose,
}: {
  open: boolean;
  live: boolean;
  repo: RepoRef | null;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const sinceRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasBackend || !live) return;
    let stop = false;
    const tick = async () => {
      const { lines: nw, lastId } = await apiActivity(sinceRef.current, repo || undefined);
      if (stop || !nw.length) return;
      sinceRef.current = lastId;
      setLines((prev) => [...prev, ...nw].slice(-120));
    };
    tick();
    const iv = setInterval(tick, 1200);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [live, repo]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 1e9 });
  }, [lines]);

  if (!hasBackend || !open) return null;
  return (
    <div className="activity">
      <div className="activity-hd">
        <span className="spin-sm" style={{ visibility: live ? "visible" : "hidden" }} />
        <span style={{ marginRight: "auto" }}>Backend activity</span>
        <button className="activity-x" onClick={onClose} title="hide">✕</button>
      </div>
      <div className="activity-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="dim">…waiting for activity</div>
        ) : (
          lines.map((l) => (
            <div className="activity-line" key={l.id}>
              <span className="activity-t">{new Date(l.t).toLocaleTimeString()}</span>
              {l.scope ? <span className="activity-scope">{l.scope}</span> : null}
              <span>{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
