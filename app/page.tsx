"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Explorer from "@/components/Explorer";
import CodeView from "@/components/CodeView";
import MarkdownView from "@/components/MarkdownView";
import GraphView from "@/components/GraphView";
import AskPanel from "@/components/AskPanel";
import {
  GH_TOKEN_LS,
  fetchFile,
  fetchLanguages,
  fetchRepoMeta,
  fetchTree,
  findReadme,
  parseRepoUrl,
} from "@/lib/github";
import { buildTree } from "@/lib/tree";
import { buildGraph, mapLimit } from "@/lib/imports";
import { ext, isSourceFile } from "@/lib/lang";
import type { FileNode, GraphData, RepoMeta, RepoRef, Tab, TreeEntry } from "@/lib/types";

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8",
  Rust: "#dea584", Java: "#b07219", "C++": "#f34b7d", C: "#555555", Ruby: "#701516",
  HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051", Kotlin: "#A97BFF", Swift: "#F05138",
};

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [tree, setTree] = useState<FileNode | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [languages, setLanguages] = useState<Record<string, number>>({});
  const [readme, setReadme] = useState<string | null>(null);
  const [readmePath, setReadmePath] = useState<string>("");

  const [contents, setContents] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [leftView, setLeftView] = useState<"explorer" | "search">("explorer");

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphBuilding, setGraphBuilding] = useState(false);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [token, setToken] = useState("");

  const [sidebarW, setSidebarW] = useState(280);
  const [askW, setAskW] = useState(440);
  const [askOpen, setAskOpen] = useState(true);

  useEffect(() => {
    try {
      setToken(localStorage.getItem(GH_TOKEN_LS) || "");
    } catch {}
  }, []);

  const blobPaths = useMemo(() => entries.filter((e) => e.type === "blob").map((e) => e.path), [entries]);
  const fileSet = useMemo(() => new Set(blobPaths), [blobPaths]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 5000);
  };

  // ---------------- repo load ----------------
  const loadRepo = useCallback(async (input: string) => {
    const parsed = parseRepoUrl(input);
    if (!parsed) {
      flash("Could not parse that — try owner/repo or a github.com URL.");
      return;
    }
    setLoading(true);
    setToast("");
    setRepo(null);
    setTree(null);
    setEntries([]);
    setContents({});
    setTabs([]);
    setActiveTab("");
    setGraph(null);
    setReadme(null);
    try {
      const m = await fetchRepoMeta(parsed.owner, parsed.repo);
      const branch = parsed.branch || m.defaultBranch;
      const ref: RepoRef = { owner: parsed.owner, repo: parsed.repo, branch };
      const treeRes = await fetchTree(ref.owner, ref.repo, ref.branch);
      const nested = buildTree(treeRes.entries);
      setMeta(m);
      setRepo(ref);
      setEntries(treeRes.entries);
      setTree(nested);
      setTruncated(treeRes.truncated);

      const paths = treeRes.entries.filter((e) => e.type === "blob").map((e) => e.path);
      const rp = findReadme(paths);
      setReadmePath(rp || "");
      if (rp) {
        try {
          setReadme(await fetchFile(ref, rp));
        } catch {
          setReadme(null);
        }
      }
      setTabs([{ kind: "readme", id: "__README__", title: rp ? rp.split("/").pop()! : "README" }]);
      setActiveTab("__README__");
      fetchLanguages(ref.owner, ref.repo).then(setLanguages).catch(() => {});
    } catch (e: any) {
      flash(e?.message || "Failed to load repository.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---------------- file open ----------------
  const openFile = useCallback(
    async (path: string) => {
      if (!repo) return;
      setTabs((prev) =>
        prev.some((t) => t.id === path)
          ? prev
          : [...prev, { kind: "file", id: path, title: path.split("/").pop() || path }]
      );
      setActiveTab(path);
      if (contents[path] !== undefined || IMG_EXTS.has(ext(path))) return;
      setLoadingFiles((s) => new Set(s).add(path));
      try {
        const text = await fetchFile(repo, path);
        setContents((c) => ({ ...c, [path]: text }));
      } catch (e: any) {
        flash(e?.message || `Could not load ${path}`);
      } finally {
        setLoadingFiles((s) => {
          const n = new Set(s);
          n.delete(path);
          return n;
        });
      }
    },
    [repo, contents]
  );

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) setActiveTab(next[Math.max(0, idx - 1)]?.id || "");
      return next;
    });
  };

  // ---------------- graph (lazy) ----------------
  const openGraph = useCallback(async () => {
    setTabs((prev) => (prev.some((t) => t.kind === "graph") ? prev : [...prev, { kind: "graph", id: "__GRAPH__", title: "Knowledge Graph" }]));
    setActiveTab("__GRAPH__");
    if (graph || graphBuilding || !repo) return;
    setGraphBuilding(true);
    try {
      const MAX = 1200;
      const sources = blobPaths.filter(isSourceFile);
      const capped = sources.slice(0, MAX);
      const skipped = sources.length - capped.length;
      const map = new Map<string, string>();
      await mapLimit(capped, 8, async (p) => {
        if (contents[p] !== undefined) {
          map.set(p, contents[p]);
          return;
        }
        try {
          map.set(p, await fetchFile(repo, p));
        } catch {}
      });
      setGraph(buildGraph(capped, map, skipped));
    } catch (e: any) {
      flash(e?.message || "Failed to build graph.");
    } finally {
      setGraphBuilding(false);
    }
  }, [graph, graphBuilding, repo, blobPaths, contents]);

  // ---------------- search ----------------
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return blobPaths.filter((p) => p.toLowerCase().includes(q)).slice(0, 200);
  }, [search, blobPaths]);

  // ---------------- ask context ----------------
  const activeFile = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTab);
    if (tab?.kind === "file" && contents[tab.id] !== undefined) return { path: tab.id, content: contents[tab.id] };
    return null;
  }, [tabs, activeTab, contents]);

  const resolvePath = useCallback(
    (codeText: string): string | null => {
      const c = codeText.trim().replace(/^\.?\//, "");
      if (fileSet.has(c)) return c;
      return blobPaths.find((p) => p === c || p.endsWith("/" + c)) || null;
    },
    [fileSet, blobPaths]
  );

  const saveToken = () => {
    try {
      if (token.trim()) localStorage.setItem(GH_TOKEN_LS, token.trim());
      else localStorage.removeItem(GH_TOKEN_LS);
    } catch {}
    setShowSettings(false);
    flash(token.trim() ? "Token saved (5000/hr + private repos)." : "Token cleared.");
  };

  // ---------------- resizers ----------------
  function startResize(which: "sidebar" | "ask", e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startSidebar = sidebarW;
    const startAsk = askW;
    (e.target as HTMLElement).classList.add("dragging");
    const move = (ev: PointerEvent) => {
      if (which === "sidebar") setSidebarW(Math.min(460, Math.max(160, startSidebar + (ev.clientX - startX))));
      else setAskW(Math.min(680, Math.max(300, startAsk - (ev.clientX - startX))));
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.querySelectorAll(".resizer.dragging").forEach((n) => n.classList.remove("dragging"));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  const gridCols = askOpen ? `48px ${sidebarW}px 5px 1fr 5px ${askW}px` : `48px ${sidebarW}px 5px 1fr`;
  const activeTabObj = tabs.find((t) => t.id === activeTab);

  return (
    <div className="app">
      {/* ---------------- top bar ---------------- */}
      <div className="topbar">
        <div className="brand">
          <span className="spark">✦</span> Repo Lens
        </div>
        <form
          className="url-form"
          onSubmit={(e) => {
            e.preventDefault();
            loadRepo(urlInput);
          }}
        >
          <input
            className="url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="owner/repo  or  https://github.com/owner/repo[/tree/branch]"
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Loading…" : "Load"}
          </button>
        </form>
        <button className="icon-btn" title="GitHub token" onClick={() => setShowSettings((s) => !s)}>
          ⚙
        </button>
        <button className="icon-btn" title="Toggle AI panel" onClick={() => setAskOpen((s) => !s)}>
          ✦
        </button>
        {showSettings && (
          <div
            style={{
              position: "absolute", top: 46, right: 10, zIndex: 40,
              background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
              padding: 14, width: 340, boxShadow: "0 12px 40px rgba(0,0,0,.45)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              GitHub token (optional) — raises rate limit to 5000/hr and unlocks private repos. Stored only in this browser.
            </div>
            <input
              className="url-input" type="password" value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… (read-only is enough)" style={{ width: "100%" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" onClick={saveToken}>Save</button>
              <button className="btn btn-ghost" onClick={() => setShowSettings(false)}>Close</button>
            </div>
          </div>
        )}
      </div>

      {/* ---------------- body ---------------- */}
      <div className="app-body" style={{ gridTemplateColumns: gridCols }}>
        {/* activity bar */}
        <div className="activitybar">
          <button className={leftView === "explorer" ? "active" : ""} title="Explorer" onClick={() => setLeftView("explorer")}>🗂️</button>
          <button className={leftView === "search" ? "active" : ""} title="Search" onClick={() => setLeftView("search")}>🔍</button>
          <button className={activeTabObj?.kind === "graph" ? "active" : ""} title="Knowledge Graph" onClick={openGraph} disabled={!repo}>🕸</button>
          <div style={{ flex: 1 }} />
          <button className={askOpen ? "active" : ""} title="AI panel" onClick={() => setAskOpen((s) => !s)}>✦</button>
        </div>

        {/* sidebar */}
        <div className="sidebar">
          {leftView === "explorer" ? (
            <>
              <div className="sidebar-head">
                <span>{repo ? `${repo.owner}/${repo.repo}` : "Explorer"}</span>
                {truncated && <span title="Tree truncated by GitHub" style={{ color: "var(--amber)" }}>⚠</span>}
              </div>
              <Explorer tree={tree} selected={activeTabObj?.kind === "file" ? activeTab : null} onOpen={openFile} />
            </>
          ) : (
            <>
              <div className="sidebar-head"><span>Search</span></div>
              <div className="search-box">
                <input
                  className="search-input" value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="filter files by path…" spellCheck={false}
                />
              </div>
              {searchResults.map((p) => (
                <div className="search-result" key={p} onClick={() => openFile(p)}>
                  <div>{p.split("/").pop()}</div>
                  <div className="sr-path">{p}</div>
                </div>
              ))}
              {search.trim().length >= 2 && searchResults.length === 0 && (
                <div style={{ padding: 14 }} className="dim">No matching files.</div>
              )}
            </>
          )}
        </div>

        {/* sidebar resizer */}
        <div className="resizer" onPointerDown={(e) => startResize("sidebar", e)} />

        {/* center */}
        <div className="center">
          <div className="tabstrip">
            {tabs.map((tab) => (
              <div key={tab.id} className={"tab" + (tab.id === activeTab ? " active" : "")} onClick={() => setActiveTab(tab.id)}>
                <span>{tab.kind === "graph" ? "🕸" : tab.kind === "readme" ? "📖" : ""}</span>
                <span>{tab.title}</span>
                {tab.kind !== "readme" && (
                  <span className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>✕</span>
                )}
              </div>
            ))}
          </div>
          <div className="center-body">
            {!repo && !loading && (
              <div className="placeholder">
                <div>
                  <div className="big">✦</div>
                  <div style={{ fontSize: 15, color: "var(--ink)", marginBottom: 8 }}>Paste a GitHub repository to begin</div>
                  <div>Try <kbd>facebook/react</kbd>, <kbd>vercel/next.js</kbd>, or any <kbd>https://github.com/owner/repo</kbd></div>
                </div>
              </div>
            )}
            {loading && <div className="placeholder"><span className="spin" /></div>}
            {repo && activeTabObj?.kind === "readme" &&
              (readme ? (
                <MarkdownView content={readme} repo={repo} readmeDir={readmePath.includes("/") ? readmePath.slice(0, readmePath.lastIndexOf("/")) : ""} />
              ) : (
                <div className="placeholder">No README found in this repository.</div>
              ))}
            {repo && activeTabObj?.kind === "graph" && <GraphView data={graph} building={graphBuilding} onOpenFile={openFile} />}
            {repo && activeTabObj?.kind === "file" &&
              (IMG_EXTS.has(ext(activeTab)) ? (
                <div className="placeholder">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}/${activeTab}`}
                    alt={activeTab} style={{ maxWidth: "90%", maxHeight: "80%" }}
                  />
                </div>
              ) : (
                <CodeView path={activeTab} content={contents[activeTab]} loading={loadingFiles.has(activeTab)} />
              ))}
          </div>
        </div>

        {/* ask resizer + panel */}
        {askOpen && (
          <>
            <div className="resizer" onPointerDown={(e) => startResize("ask", e)} />
            <AskPanel
              repoRef={repo}
              repoLabel={repo ? `${repo.owner}/${repo.repo}@${repo.branch}` : ""}
              treeText={blobPaths.join("\n")}
              readme={readme}
              activeFile={activeFile}
              resolvePath={resolvePath}
              onOpenFile={openFile}
            />
          </>
        )}
      </div>

      {/* ---------------- status bar ---------------- */}
      <div className="statusbar">
        {repo ? (
          <>
            <span className="si">⎇ {repo.branch}</span>
            <span className="si">{repo.owner}/{repo.repo}</span>
            {meta && <span className="si">★ {meta.stars.toLocaleString()}</span>}
            <span className="si">{blobPaths.length.toLocaleString()} files</span>
            {graph && <span className="si">🕸 {graph.nodes.length} nodes · {graph.links.length} edges</span>}
            {totalBytes > 0 && (
              <span className="si">
                <span className="langbar">
                  {Object.entries(languages)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([lang, bytes]) => (
                      <span key={lang} title={`${lang} ${((bytes / totalBytes) * 100).toFixed(1)}%`}
                        style={{ width: `${(bytes / totalBytes) * 100}%`, background: LANG_COLORS[lang] || "#888" }} />
                    ))}
                </span>
                {meta?.language}
              </span>
            )}
          </>
        ) : (
          <span className="si">Ready — paste a GitHub link above</span>
        )}
        <span className="push" />
        <span className="si">Repo Lens</span>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
