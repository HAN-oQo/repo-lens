"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Explorer from "@/components/Explorer";
import StructureView from "@/components/StructureView";
import CodeView from "@/components/CodeView";
import MarkdownView from "@/components/MarkdownView";
import GraphView from "@/components/GraphView";
import AskPanel from "@/components/AskPanel";
import ActivityLog from "@/components/ActivityLog";
import {
  DEFAULT_OAUTH_BASE,
  GH_TOKEN_LS,
  OAUTH_BASE_LS,
  consumeOAuthToken,
  fetchFile,
  fetchLanguages,
  fetchRepoMeta,
  fetchTree,
  findReadme,
  parseRepoUrl,
  searchRepos,
  signOut,
  startGitHubLogin,
  validateToken,
  type RepoHit,
} from "@/lib/github";
import { buildTree } from "@/lib/tree";
import { buildGraph, mapLimit } from "@/lib/imports";
import { ext, isSourceFile } from "@/lib/lang";
import { hasBackend, apiLoadRepo, apiFileText, apiSearch, apiRawUrl, apiGraph, apiUsageFlow, apiSuggest, type SearchHit } from "@/lib/api";
import type { FileNode, GraphData, RepoMeta, RepoRef, Tab, TreeEntry } from "@/lib/types";

// graph-area tab ids (V5): two seeded tabs — full overview + README usage flow.
const GRAPH_OVERVIEW = "__GRAPH_OVERVIEW__";
const GRAPH_QUICKSTART = "__GRAPH_QUICKSTART__";
const GRAPH_TABS: Tab[] = [
  { kind: "graph", id: GRAPH_OVERVIEW, title: "Overview", view: "overview" },
  { kind: "graph", id: GRAPH_QUICKSTART, title: "Quickstart", view: "quickstart" },
];
import { serializeRepoState, parseRepoState, repoStateToInput, REPO_STATE_LS } from "@/lib/persist";
import { type GraphMode, modeConfig } from "@/lib/graphModes";
import { parseVizRequest } from "@/lib/vizQuery";

const IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8",
  Rust: "#dea584", Java: "#b07219", "C++": "#f34b7d", C: "#555555", Ruby: "#701516",
  HTML: "#e34c26", CSS: "#563d7c", Shell: "#89e051", Kotlin: "#A97BFF", Swift: "#F05138",
};

export default function Home() {
  const [urlInput, setUrlInput] = useState("");
  const [suggest, setSuggest] = useState<RepoHit[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
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
  const [leftView, setLeftView] = useState<"explorer" | "structure" | "search">("explorer");

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [graphBuilding, setGraphBuilding] = useState(false);
  const [focusGraph, setFocusGraph] = useState<GraphData | null>(null);
  const [focusLabel, setFocusLabel] = useState("");
  const [graphMode, setGraphMode] = useState<GraphMode | null>(null); // V4: chosen viz (null = default)
  // V6: query-driven graph tabs — each holds its own focus subgraph + viz; + entry-point chips.
  const [queryTabs, setQueryTabs] = useState<Record<string, { label: string; data: GraphData; viz: GraphMode }>>({});
  const querySeq = useRef(0);
  const [suggestions, setSuggestions] = useState<{ label: string; question: string; symbol?: string }[]>([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [token, setToken] = useState("");
  const [oauthUrl, setOauthUrl] = useState("");
  const [authLogin, setAuthLogin] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [validating, setValidating] = useState(false);

  const [sidebarW, setSidebarW] = useState(280);
  const [askW, setAskW] = useState(440);
  const [askOpen, setAskOpen] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [mdRaw, setMdRaw] = useState(false);

  useEffect(() => {
    const consumed = consumeOAuthToken(); // returns token if we just came back from OAuth
    let tk = "";
    try {
      tk = localStorage.getItem(GH_TOKEN_LS) || "";
      setOauthUrl(localStorage.getItem(OAUTH_BASE_LS) || DEFAULT_OAUTH_BASE);
    } catch {}
    setToken(tk);
    if (tk) {
      validateToken(tk)
        .then(setAuthLogin)
        .catch(() => {});
      if (consumed) flash("Signed in with GitHub.");
    }
  }, []);

  // repo autocomplete (debounced GitHub search; star-sorted, internal-first when logged in)
  useEffect(() => {
    const q = urlInput.trim();
    if (q.length < 2 || /github\.com|https?:\/\//i.test(q)) {
      setSuggest([]);
      return;
    }
    const id = setTimeout(() => {
      searchRepos(q).then((hits) => {
        setSuggest(hits);
        setShowSuggest(true);
      });
    }, 280);
    return () => clearTimeout(id);
  }, [urlInput]);

  const pickSuggest = (full: string) => {
    setUrlInput(full);
    setShowSuggest(false);
    setSuggest([]);
    loadRepo(full);
  };

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
    setFocusGraph(null);
    setFocusLabel("");
    setReadme(null);
    try {
      let ref: RepoRef;
      let treeEntries: TreeEntry[];
      let rp: string | null;
      if (hasBackend) {
        // Backend: clones server-side, returns tree + README in one call (fast, large-repo ready).
        const d = await apiLoadRepo(input, parsed.branch);
        ref = { owner: d.repo.owner, repo: d.repo.repo, branch: d.repo.branch };
        treeEntries = d.tree;
        rp = d.readmePath;
        setMeta({ defaultBranch: d.repo.branch, description: null, language: null, stars: 0, private: false });
        setReadme(d.readme ?? null);
        setTruncated(false);
      } else {
        const m = await fetchRepoMeta(parsed.owner, parsed.repo);
        ref = { owner: parsed.owner, repo: parsed.repo, branch: parsed.branch || m.defaultBranch };
        const treeRes = await fetchTree(ref.owner, ref.repo, ref.branch);
        treeEntries = treeRes.entries;
        rp = findReadme(treeEntries.filter((e) => e.type === "blob").map((e) => e.path));
        setMeta(m);
        setTruncated(treeRes.truncated);
        setReadme(rp ? await fetchFile(ref, rp).catch(() => null) : null);
        fetchLanguages(ref.owner, ref.repo).then(setLanguages).catch(() => {});
      }
      setRepo(ref);
      setEntries(treeEntries);
      setTree(buildTree(treeEntries));
      setReadmePath(rp || "");
      // V5: seed the graph area with two tabs — Overview (full) + Quickstart (usage flow).
      setTabs([{ kind: "readme", id: "__README__", title: rp ? rp.split("/").pop()! : "README" }, ...GRAPH_TABS]);
      setActiveTab("__README__");
    } catch (e: any) {
      flash(e?.message || "Failed to load repository.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- session persistence (P1): restore the viewed repo on reload ----
  // On mount, read the repo from the URL (?repo=owner/repo&ref=branch) or localStorage
  // and auto-load it, so a refresh keeps you on the same repo.
  useEffect(() => {
    let saved: RepoRef | null = null;
    try {
      saved = parseRepoState(window.location.search) || parseRepoState(localStorage.getItem(REPO_STATE_LS));
    } catch {}
    if (saved) {
      setUrlInput(`${saved.owner}/${saved.repo}`);
      loadRepo(repoStateToInput(saved));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the loaded repo to the URL + localStorage whenever it changes.
  useEffect(() => {
    if (!repo) return;
    const qs = serializeRepoState(repo);
    try {
      localStorage.setItem(REPO_STATE_LS, qs);
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    } catch {}
  }, [repo]);

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
        const text = hasBackend ? await apiFileText(repo, path) : await fetchFile(repo, path);
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
  // Build/poll the symbol graph (+ usage-flow focus). No tab manipulation — that's
  // openGraph's job; this is also called lazily when a graph tab is activated.
  const buildGraphIfNeeded = useCallback(async () => {
    if (graph || graphBuilding || !repo) return;
    setGraphBuilding(true);

    if (hasBackend) {
      // Backend builds the symbol graph (graphify) in the background; poll until ready.
      try {
        const deadline = Date.now() + 6 * 60 * 1000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const g = await apiGraph(repo);
          if (g.status === "ready") {
            setGraph(g);
            // U4: default the view to the README usage flow; overview stays one click away.
            try {
              const flow = await apiUsageFlow(repo);
              if (flow.status === "ready" && flow.nodes?.length) {
                setFocusGraph(flow);
                setFocusLabel("Usage flow — what the README's quickstart runs");
              }
            } catch {}
            break;
          }
          if (g.status === "error" || g.status === "unavailable") {
            flash(g.error || "Graph unavailable on the server.");
            break;
          }
          if (Date.now() > deadline) { flash("Graph build timed out."); break; }
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (e: any) {
        flash(e?.message || "Failed to load graph.");
      } finally {
        setGraphBuilding(false);
      }
      return;
    }

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

  // Open (and focus) the graph area's Overview tab, ensuring the two graph tabs exist.
  const openGraph = useCallback(() => {
    setTabs((prev) => (prev.some((t) => t.id === GRAPH_OVERVIEW) ? prev : [...prev, ...GRAPH_TABS]));
    setActiveTab(GRAPH_OVERVIEW);
    buildGraphIfNeeded();
  }, [buildGraphIfNeeded]);

  // Lazy build: when any graph tab becomes active (e.g. clicking Quickstart in the tab
  // bar), kick off the build without yanking the user to a different tab.
  useEffect(() => {
    if (activeTab === GRAPH_OVERVIEW || activeTab === GRAPH_QUICKSTART) buildGraphIfNeeded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // V4: open the graph in a specific visualization mode (force/dag/tree/mermaid).
  const showViz = useCallback((m: GraphMode) => { setGraphMode(m); openGraph(); }, [openGraph]);

  // V6: fetch example entry-point chips for the loaded repo (backend mode).
  useEffect(() => {
    if (!hasBackend || !repo) { setSuggestions([]); return; }
    let stop = false;
    apiSuggest(repo).then((r) => { if (!stop) setSuggestions(r.suggestions || []); }).catch(() => {});
    return () => { stop = true; };
  }, [repo, graph]);

  // ---------------- search ----------------
  // Browser mode: filename filter. Backend mode: full-text via ripgrep/git-grep.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (hasBackend || q.length < 2) return [];
    return blobPaths.filter((p) => p.toLowerCase().includes(q)).slice(0, 200);
  }, [search, blobPaths]);

  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!hasBackend || !repo) return;
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => {
      apiSearch(repo, q).then((r) => setHits(r.matches)).catch(() => setHits([]));
    }, 180); // debounce
    return () => clearTimeout(id);
  }, [search, repo]);

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

  const saveToken = async () => {
    const tk = token.trim();
    setAuthErr("");
    setAuthLogin("");
    try {
      if (tk) localStorage.setItem(GH_TOKEN_LS, tk);
      else localStorage.removeItem(GH_TOKEN_LS);
    } catch {}
    if (!tk) {
      flash("Token cleared.");
      setShowSettings(false);
      return;
    }
    setValidating(true);
    try {
      const login = await validateToken(tk);
      setAuthLogin(login);
      flash(`Token OK — authenticated as ${login}. Private repos & 5000/hr enabled.`);
    } catch (e: any) {
      setAuthErr(e?.message || "Token check failed.");
    } finally {
      setValidating(false);
    }
  };

  const signInGitHub = () => {
    const base = oauthUrl.trim();
    setAuthErr("");
    if (!base) {
      setAuthErr("Set the auth server URL first (your deployed OAuth worker).");
      return;
    }
    try {
      localStorage.setItem(OAUTH_BASE_LS, base);
    } catch {}
    startGitHubLogin(base); // navigates away to GitHub
  };

  const doSignOut = () => {
    signOut();
    setToken("");
    setAuthLogin("");
    setAuthErr("");
    flash("Signed out of GitHub.");
  };

  // Ask → graph: when the server returns a focused subgraph along with the answer,
  // open the graph tab and show that subgraph so the user sees the relevant code flow.
  // V6: on an answer with a focus subgraph, open a NEW query tab rendering that
  // subgraph in the viz the question asked for ("…as a flowchart" → mermaid; default DAG).
  const handleAskDone = useCallback((fg: GraphData, question?: string) => {
    if (!fg || !fg.nodes || !fg.nodes.length) return;
    const viz = parseVizRequest(question || "").viz || "dag";
    const id = `__GRAPH_Q${++querySeq.current}__`;
    const label = (question || "Query").trim().replace(/\s+/g, " ").slice(0, 36) || "Query";
    setQueryTabs((prev) => ({ ...prev, [id]: { label, data: fg, viz } }));
    setTabs((prev) => [...prev, { kind: "graph", id, title: label, view: "query" }]);
    setActiveTab(id);
  }, []);
  const clearFocus = () => { setFocusGraph(null); setFocusLabel(""); };

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
  const activeQueryTab = activeTabObj?.view === "query" ? queryTabs[activeTab] : null; // V6
  const isMd = (p: string) => /\.(md|markdown|mdx)$/i.test(p);
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  // markdown is showable (rendered) for the README tab or any .md file tab
  const mdActive =
    activeTabObj?.kind === "readme" ||
    (activeTabObj?.kind === "file" && isMd(activeTab) && contents[activeTab] !== undefined);

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
          <div className="url-wrap">
            <input
              className="url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={() => suggest.length && setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              placeholder="search a repo (e.g. vllm) — or owner/repo, or a github.com URL"
              spellCheck={false}
            />
            {showSuggest && suggest.length > 0 && (
              <div className="url-suggest">
                {suggest.map((h) => (
                  <div
                    key={h.full_name}
                    className="us-item"
                    onMouseDown={(e) => { e.preventDefault(); pickSuggest(h.full_name); }}
                  >
                    <div className="us-top">
                      <span className="us-name">{h.full_name}</span>
                      {h.private ? <span className="us-badge">internal</span> : <span className="us-star">★ {h.stars.toLocaleString()}</span>}
                    </div>
                    {h.description && <div className="us-desc">{h.description}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
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
              padding: 14, width: 380, boxShadow: "0 12px 40px rgba(0,0,0,.45)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>GitHub access — for private repos</div>

            {authLogin ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 10px" }}>
                <span style={{ fontSize: 13, color: "var(--green)" }}>✓ Signed in as <b>{authLogin}</b></span>
                <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={doSignOut}>Sign out</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8, lineHeight: 1.55 }}>
                  Sign in with GitHub to load any repo you can access (your permissions, SSO handled automatically). The token lives only in this browser.
                </div>
                <label style={{ fontSize: 11, color: "var(--muted)" }}>Auth server URL (your deployed OAuth worker)</label>
                <input
                  className="url-input" type="text" value={oauthUrl}
                  onChange={(e) => setOauthUrl(e.target.value)}
                  placeholder="https://repolens-auth.<you>.workers.dev"
                  style={{ width: "100%", marginTop: 3 }} spellCheck={false}
                />
                <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={signInGitHub}>
                  Sign in with GitHub
                </button>
              </>
            )}

            {authErr && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>✕ {authErr}</div>}

            <details style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>Or paste a token instead (no server needed)</summary>
              <input
                className="url-input" type="password" value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_… or ghp_…" style={{ width: "100%", marginTop: 8 }} spellCheck={false}
              />
              <button className="btn" style={{ marginTop: 8 }} onClick={saveToken} disabled={validating}>
                {validating ? "Checking…" : "Save & verify token"}
              </button>
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 10, lineHeight: 1.6 }}>
                Settings → Developer settings → Tokens. Fine-grained: the repo + <code style={{ font: "11px var(--mono)" }}>Contents/Metadata: Read</code>; classic: <code style={{ font: "11px var(--mono)" }}>repo</code> scope. Org with SAML SSO: click <b>Authorize</b> on the token.
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
          <button className={leftView === "structure" ? "active" : ""} title="Structure" onClick={() => setLeftView("structure")} disabled={!repo}>📂</button>
          <button className={leftView === "search" ? "active" : ""} title="Search" onClick={() => setLeftView("search")}>🔍</button>
          <button className={activeTabObj?.kind === "graph" && !graphMode ? "active" : ""} title="Knowledge Graph" onClick={() => { setGraphMode(null); openGraph(); }} disabled={!repo}>🕸</button>
          {(["dag", "tree", "mermaid"] as GraphMode[]).map((m) => {
            const c = modeConfig(m);
            return (
              <button
                key={m}
                className={activeTabObj?.kind === "graph" && graphMode === m ? "active" : ""}
                title={c.label}
                onClick={() => showViz(m)}
                disabled={!repo}
              >{c.icon}</button>
            );
          })}
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
          ) : leftView === "structure" ? (
            <>
              <div className="sidebar-head"><span>Structure</span></div>
              <StructureView tree={tree} selected={activeTabObj?.kind === "file" ? activeTab : null} onOpen={openFile} repo={repo} />
            </>
          ) : (
            <>
              <div className="sidebar-head"><span>{hasBackend ? "Search (full-text)" : "Search"}</span></div>
              <div className="search-box">
                <input
                  className="search-input" value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={hasBackend ? "search code…" : "filter files by path…"} spellCheck={false}
                />
              </div>
              {hasBackend
                ? hits.map((h, i) => (
                    <div className="search-result" key={h.path + ":" + h.line + ":" + i} onClick={() => openFile(h.path)}>
                      <div className="sr-path">{h.path}:{h.line}</div>
                      <div style={{ font: "11px var(--mono)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.preview}</div>
                    </div>
                  ))
                : searchResults.map((p) => (
                    <div className="search-result" key={p} onClick={() => openFile(p)}>
                      <div>{p.split("/").pop()}</div>
                      <div className="sr-path">{p}</div>
                    </div>
                  ))}
              {search.trim().length >= 2 && (hasBackend ? hits.length === 0 : searchResults.length === 0) && (
                <div style={{ padding: 14 }} className="dim">No matches.</div>
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
            {repo && mdActive && (
              <div className="md-toggle">
                <button className={mdRaw ? "" : "on"} onClick={() => setMdRaw(false)}>Rendered</button>
                <button className={mdRaw ? "on" : ""} onClick={() => setMdRaw(true)}>Raw</button>
              </div>
            )}
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
                mdRaw ? (
                  <CodeView path={readmePath || "README.md"} content={readme} loading={false} />
                ) : (
                  <MarkdownView content={readme} repo={repo} readmeDir={dirOf(readmePath)} />
                )
              ) : (
                <div className="placeholder">No README found in this repository.</div>
              ))}
            {repo && activeTabObj?.kind === "graph" && <GraphView data={graph} building={graphBuilding} onOpenFile={openFile} repo={repo} fileCount={blobPaths.length} focusGraph={activeQueryTab ? activeQueryTab.data : (activeTabObj.view === "overview" ? null : focusGraph)} focusLabel={activeQueryTab ? activeQueryTab.label : (activeTabObj.view === "overview" ? "" : focusLabel)} onClearFocus={() => setActiveTab(GRAPH_OVERVIEW)} mode={activeQueryTab ? activeQueryTab.viz : graphMode} />}
            {repo && activeTabObj?.kind === "file" &&
              (IMG_EXTS.has(ext(activeTab)) ? (
                <div className="placeholder">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={hasBackend ? apiRawUrl(repo, activeTab) : `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.branch}/${activeTab}`}
                    alt={activeTab} style={{ maxWidth: "90%", maxHeight: "80%" }}
                  />
                </div>
              ) : isMd(activeTab) && !mdRaw && contents[activeTab] !== undefined ? (
                <MarkdownView content={contents[activeTab]} repo={repo} readmeDir={dirOf(activeTab)} />
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
              onAskDone={handleAskDone}
              suggestions={suggestions}
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
        {hasBackend && (
          <span
            className={"si act-toggle" + (loading || graphBuilding ? " busy" : "")}
            title="Show what the backend is doing"
            onClick={() => setShowActivity((s) => !s)}
          >
            ⧉ activity
          </span>
        )}
        <span className="si" title="build — should match the latest commit">Repo Lens · {process.env.NEXT_PUBLIC_BUILD || "dev"}</span>
      </div>

      <ActivityLog
        open={showActivity || loading || graphBuilding}
        live={loading || graphBuilding || showActivity}
        repo={repo}
        onClose={() => setShowActivity(false)}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
