"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoRef } from "@/lib/types";
import { mdToHtml } from "@/lib/md";
import { hasBackend, apiAsk, apiModels, type ModelOptions } from "@/lib/api";

/* ============================ providers (ported from ask.js) ============================ */

const DEFAULT_BOT_URL = "https://askbot.ce.moreh.dev/ask";
const LS_PROV = "ask-ai-provider";
const LS_WEB = "ask-ai-web";
const LS_LANG = "repolens-lang";
const keyLS = (p: string) => "ask-ai-key-" + p;
const modelLS = (p: string) => "ask-ai-model-" + p;
const urlLS = (p: string) => "ask-ai-url-" + p;

type Msg = {
  role: "user" | "assistant" | "divider";
  content?: string;
  cites?: { url: string; title: string }[];
  model?: string;
  from?: string;
  to?: string;
};
type Parsed = { text?: string; cites?: { url: string; title: string }[]; err?: string; cancelled?: boolean };
type SendCtx = {
  model: string;
  key: string;
  sys: string;
  convo: Msg[];
  web: boolean;
  alive: () => boolean;
  onProgress: (partial: string, thinking: string) => void;
};
interface Provider {
  label: string;
  models?: string[];
  cloudModels?: string[];
  defModel: string;
  needsUrl?: boolean;
  url: (model?: string, key?: string) => string;
  headers: (key: string) => Record<string, string>;
  body: (model: string, sys: string, msgs: Msg[], web: boolean) => unknown;
  parse: (d: any) => Parsed;
  send?: (ctx: SendCtx) => Promise<Parsed>;
}

function lsget(k: string, d = ""): string {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
}
function lsset(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

const PROVIDERS: Record<string, Provider> = {
  bot: {
    label: "My Claude bot (Agent SDK)",
    needsUrl: true,
    models: ["claude-moreh-Qwen3.6-27B", "claude-moreh-gemma-4-31B-it", "claude-moreh-DeepSeek-V4-Flash"],
    cloudModels: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    defModel: "claude-moreh-Qwen3.6-27B",
    url: () => {
      const u = (lsget(urlLS("bot"), "") || DEFAULT_BOT_URL).trim().replace(/\/+$/, "");
      return /\/ask$/.test(u) ? u : u + "/ask";
    },
    headers: (key) => {
      const h: Record<string, string> = { "content-type": "application/json" };
      if (key) h["x-access-token"] = key;
      return h;
    },
    body: (model, sys, msgs, web) => {
      const q =
        msgs.length === 1
          ? msgs[0].content
          : msgs.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + (m.content || "")).join("\n\n");
      return { model, system: sys, question: q, messages: msgs, web: !!web, page_url: location.pathname };
    },
    parse: (d) => (d.error ? { err: d.error.message || d.error } : { text: d.answer || "", cites: d.sources || [] }),
    send(ctx) {
      const prov = this;
      const headers = prov.headers(ctx.key);
      const askUrl = prov.url();
      const resBase = askUrl.replace(/\/ask$/, "/result");
      return fetch(askUrl, { method: "POST", headers, body: JSON.stringify(prov.body(ctx.model, ctx.sys, ctx.convo, ctx.web)) })
        .then((r) => r.json())
        .then((d: any) => {
          if (d.error) throw new Error(d.error.message || d.error);
          if (d.answer != null) return { text: d.answer, cites: d.sources || [] };
          if (!d.id) throw new Error("no job id from bot");
          return new Promise<Parsed>((resolve, reject) => {
            let tries = 0;
            const MAX = 360;
            const IVL = 1000;
            const poll = () => {
              if (!ctx.alive()) {
                resolve({ cancelled: true });
                return;
              }
              tries++;
              fetch(resBase + "?id=" + encodeURIComponent(d.id), { headers })
                .then((r) => r.json())
                .then((j: any) => {
                  if (j.status === "done") resolve({ text: j.answer || "", cites: j.sources || [] });
                  else if (j.status === "error") reject(new Error(j.error || "bot error"));
                  else if (tries >= MAX) reject(new Error("timeout waiting for the bot"));
                  else {
                    if ((j.partial || j.thinking) && ctx.onProgress) ctx.onProgress(j.partial || "", j.thinking || "");
                    setTimeout(poll, IVL);
                  }
                })
                .catch((e) => (tries >= MAX ? reject(e) : setTimeout(poll, IVL)));
            };
            poll();
          });
        });
    },
  },
  claude: {
    label: "Claude (your API key)",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"],
    defModel: "claude-sonnet-4-6",
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (key) => {
      const h: Record<string, string> = {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (/^sk-ant-oat/.test(key)) {
        h["authorization"] = "Bearer " + key;
        h["anthropic-beta"] = "oauth-2025-04-20";
      } else h["x-api-key"] = key;
      return h;
    },
    body: (model, sys, msgs, web) => {
      const b: any = {
        model,
        max_tokens: 2000,
        system: sys,
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
      };
      if (web) b.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
      return b;
    },
    parse: (d) => {
      if (d.error) return { err: d.error.message || JSON.stringify(d.error) };
      let text = "";
      const cites: { url: string; title: string }[] = [];
      (d.content || []).forEach((b: any) => {
        if (b.type === "text") {
          text += b.text;
          (b.citations || []).forEach((c: any) => c.url && cites.push({ url: c.url, title: c.title || c.url }));
        }
      });
      return { text, cites };
    },
  },
  openai: {
    label: "OpenAI (your API key)",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    defModel: "gpt-4o-mini",
    url: () => "https://api.openai.com/v1/responses",
    headers: (key) => ({ "content-type": "application/json", authorization: "Bearer " + key }),
    body: (model, sys, msgs, web) => {
      const b: any = { model, instructions: sys, input: msgs.map((m) => ({ role: m.role, content: m.content })) };
      if (web) b.tools = [{ type: "web_search_preview" }];
      return b;
    },
    parse: (d) => {
      if (d.error) return { err: d.error.message || JSON.stringify(d.error) };
      let text = "";
      const cites: { url: string; title: string }[] = [];
      if (typeof d.output_text === "string" && d.output_text) text = d.output_text;
      (d.output || []).forEach((item: any) =>
        (item.content || []).forEach((c: any) => {
          if (c.type === "output_text") {
            if (!text) text += c.text || "";
            (c.annotations || []).forEach((a: any) => a.url && cites.push({ url: a.url, title: a.title || a.url }));
          }
        })
      );
      return { text, cites };
    },
  },
  gemini: {
    label: "Gemini (your API key)",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    defModel: "gemini-2.0-flash",
    url: (model, key) =>
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model || "") +
      ":generateContent?key=" +
      encodeURIComponent(key || ""),
    headers: () => ({ "content-type": "application/json" }),
    body: (model, sys, msgs, web) => {
      const b: any = {
        systemInstruction: { parts: [{ text: sys }] },
        contents: msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      };
      if (web) b.tools = [{ google_search: {} }];
      return b;
    },
    parse: (d) => {
      if (d.error) return { err: d.error.message || JSON.stringify(d.error) };
      let text = "";
      const cites: { url: string; title: string }[] = [];
      const cand = (d.candidates || [])[0];
      if (cand?.content?.parts) cand.content.parts.forEach((p: any) => p.text && (text += p.text));
      return { text, cites };
    },
  },
  proxy: {
    label: "Proxy (your server)",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    defModel: "claude-sonnet-4-6",
    needsUrl: true,
    url: () => lsget(urlLS("proxy"), ""),
    headers: (key) => {
      const h: Record<string, string> = { "content-type": "application/json" };
      if (key) h["x-access-token"] = key;
      return h;
    },
    body: (model, sys, msgs) => ({ model, max_tokens: 2000, system: sys, messages: msgs.map((m) => ({ role: m.role, content: m.content })) }),
    parse: (d) => PROVIDERS.claude.parse(d),
  },
};

function curProv(): string {
  const p = lsget(LS_PROV, "bot");
  return PROVIDERS[p] ? p : "bot";
}
const mlabel = (id: string) => String(id).replace(/^claude-moreh-/, "");

/* ============================ context props ============================ */

export interface AskContext {
  repoRef: RepoRef | null;
  repoLabel: string;
  treeText: string;
  readme: string | null;
  activeFile: { path: string; content: string } | null;
  resolvePath: (codeText: string) => string | null;
  onOpenFile: (path: string) => void;
  onAskDone?: (focusGraph: any) => void;
}

function clip(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "\n…(truncated)" : s;
}

/* ============================ component ============================ */

export default function AskPanel(ctx: AskContext) {
  const [provider, setProvider] = useState("bot");
  const [model, setModel] = useState("");
  const [convo, setConvo] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [thinking, setThinking] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [setOpen, setSetOpen] = useState(false);
  const [web, setWeb] = useState(false);
  const [ko, setKo] = useState(false);
  const [input, setInput] = useState("");
  const [botModels, setBotModels] = useState<string[] | null>(null);
  const [beModels, setBeModels] = useState<ModelOptions | null>(null); // backend (CE) model picker

  // settings form fields
  const [fKey, setFKey] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fModel, setFModel] = useState("");

  const reqSeq = useRef(0);
  const askStart = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const t = useCallback((en: string, k: string) => (ko ? k : en), [ko]);

  // init from localStorage
  useEffect(() => {
    const p = curProv();
    setProvider(p);
    setModel(lsget(modelLS(p), "") || PROVIDERS[p].defModel);
    setWeb(lsget(LS_WEB, "0") === "1");
    setKo(lsget(LS_LANG, "en") === "ko");
  }, []);

  // backend (CE) mode: discover models from the server (cloud + live local list)
  useEffect(() => {
    if (!hasBackend) return;
    apiModels().then((m) => {
      setBeModels(m);
      const remembered = lsget(modelLS("backend"), "");
      const all = [...m.cloud, ...m.local];
      setModel(remembered && all.includes(remembered) ? remembered : m.def || all[0] || "");
    });
  }, []);
  const pickModel = (val: string) => {
    setModel(val);
    lsset(modelLS("backend"), val);
  };

  // load form when provider changes / settings open
  useEffect(() => {
    setFKey(lsget(keyLS(provider), ""));
    setFUrl(lsget(urlLS(provider), "") || (provider === "bot" ? DEFAULT_BOT_URL : ""));
    setFModel(lsget(modelLS(provider), "") || PROVIDERS[provider].defModel);
  }, [provider, setOpen]);

  // discover bot models
  useEffect(() => {
    if (provider !== "bot") return;
    const base = (lsget(urlLS("bot"), "") || DEFAULT_BOT_URL).trim().replace(/\/+$/, "").replace(/\/ask$/, "");
    const tok = lsget(keyLS("bot"), "").trim();
    const h: Record<string, string> = {};
    if (tok) h["x-access-token"] = tok;
    fetch(base + "/models", { headers: h })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.models?.length) setBotModels(d.models.map((m: any) => (typeof m === "string" ? m : m.id)));
      })
      .catch(() => {});
  }, [provider]);

  // per-repo conversation persistence
  const convoKey = "repolens:convo:" + (ctx.repoLabel || "none");
  useEffect(() => {
    try {
      setConvo(JSON.parse(sessionStorage.getItem(convoKey) || "[]"));
    } catch {
      setConvo([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(convoKey, JSON.stringify(convo));
    } catch {
      /* ignore */
    }
  }, [convo, convoKey]);

  // autoscroll
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [convo, partial, thinking, busy]);

  // delegated file-link clicks inside answers
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a.filelink") as HTMLElement | null;
      if (a?.dataset.path) {
        e.preventDefault();
        ctx.onOpenFile(a.dataset.path);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [ctx]);

  function buildSystem(): string {
    const parts: string[] = [];
    parts.push(
      `You are a code assistant embedded in "Repo Lens", a tool for reading GitHub repositories. ` +
        `The user is viewing the repository ${ctx.repoLabel || "(none loaded)"}. ` +
        `Ground every answer in the repository context below. Be concise and precise. ` +
        `When you mention a file, write its repo-relative path in backticks (e.g. \`src/app.ts\`) so it becomes a clickable link. ` +
        `If the context is insufficient, say what other file you'd need to see. ` +
        `Answer in ${ko ? "Korean" : "English"}.`
    );
    if (ctx.treeText) parts.push("=== FILE TREE ===\n" + clip(ctx.treeText, 6000));
    if (ctx.readme) parts.push("=== README ===\n" + clip(ctx.readme, 4000));
    if (ctx.activeFile)
      parts.push(`=== OPEN FILE: ${ctx.activeFile.path} ===\n` + clip(ctx.activeFile.content, 12000));
    return parts.join("\n\n");
  }

  function stopGen() {
    if (!busy) return;
    reqSeq.current++;
    if (tick.current) clearInterval(tick.current);
    askStart.current = 0;
    if (partial.trim()) {
      setConvo((c) => [...c, { role: "assistant", content: partial.trim() + "\n\n— " + t("(stopped)", "(중단됨)"), cites: [] }]);
    }
    setPartial("");
    setThinking("");
    setBusy(false);
  }

  function clearChat() {
    if (busy) {
      reqSeq.current++;
      if (tick.current) clearInterval(tick.current);
      askStart.current = 0;
      setBusy(false);
    }
    setConvo([]);
    setPartial("");
    setThinking("");
    setError("");
  }

  function send(question: string) {
    if (busy) return;
    const q = question.trim();
    if (!q) return;

    // Backend mode needs a loaded repo (GraphRAG runs against the clone).
    if (hasBackend && !ctx.repoRef) {
      setError(t("Load a repository first — paste a repo above.", "먼저 레포를 로드하세요 — 위에 레포를 붙여넣으세요."));
      return;
    }

    // Backend (CE) mode: server-side GraphRAG. Ignores client providers/keys.
    if (hasBackend && ctx.repoRef) {
      const nextConvo: Msg[] = [...convo, { role: "user", content: q }];
      setConvo(nextConvo);
      setInput("");
      setError("");
      const myReq = ++reqSeq.current;
      askStart.current = Date.now();
      setElapsed(0);
      setBusy(true);
      if (tick.current) clearInterval(tick.current);
      tick.current = setInterval(() => {
        if (myReq === reqSeq.current) setElapsed(Math.round((Date.now() - askStart.current) / 1000));
      }, 1000);
      apiAsk(ctx.repoRef, q, ctx.activeFile?.path, ko, model)
        .then((out) => {
          if (myReq !== reqSeq.current) return;
          setConvo((c) => [...c, { role: "assistant", content: out.answer || t("(no answer)", "(응답 없음)"), cites: [] }]);
          // If the server extracted a focused subgraph around the answer, hand it
          // to the parent so the graph view can zoom in on the relevant symbols.
          if (out.focusGraph && ctx.onAskDone) ctx.onAskDone(out.focusGraph);
        })
        .catch((e) => {
          if (myReq !== reqSeq.current) return;
          setError(t("Request failed: ", "요청 실패: ") + (e?.message || e));
        })
        .finally(() => {
          if (myReq !== reqSeq.current) return;
          if (tick.current) clearInterval(tick.current);
          askStart.current = 0;
          setBusy(false);
        });
      return;
    }

    const prov = PROVIDERS[provider];
    const key = lsget(keyLS(provider), "").trim();
    setError("");
    if (prov.needsUrl) {
      if (!prov.url()) {
        setSetOpen(true);
        setError(t("Set the server URL first.", "먼저 서버 URL을 입력하세요."));
        return;
      }
    } else if (!key) {
      setSetOpen(true);
      setError(t("Enter your API key first.", "먼저 API 키를 입력하세요."));
      return;
    }

    const userMsg: Msg = { role: "user", content: q, model };
    const nextConvo = [...convo, userMsg];
    setConvo(nextConvo);
    setInput("");

    const myReq = ++reqSeq.current;
    askStart.current = Date.now();
    setPartial("");
    setThinking("");
    setElapsed(0);
    setBusy(true);
    if (tick.current) clearInterval(tick.current);
    tick.current = setInterval(() => {
      if (myReq === reqSeq.current) setElapsed(Math.round((Date.now() - askStart.current) / 1000));
    }, 1000);

    const sys = buildSystem();
    const sendConvo = nextConvo.filter((m) => m.role === "user" || m.role === "assistant");

    const run: Promise<Parsed> = prov.send
      ? prov.send({
          model,
          key,
          sys,
          convo: sendConvo,
          web,
          alive: () => myReq === reqSeq.current,
          onProgress: (pp, th) => {
            if (myReq !== reqSeq.current) return;
            setPartial(pp);
            setThinking(th || "");
          },
        })
      : fetch(prov.url(model, key), {
          method: "POST",
          headers: prov.headers(key),
          body: JSON.stringify(prov.body(model, sys, sendConvo, web)),
        })
          .then((r) => r.json())
          .then((d) => {
            const out = prov.parse(d);
            if (out.err) throw new Error(out.err);
            return out;
          });

    run
      .then((out) => {
        if (myReq !== reqSeq.current || out.cancelled) return;
        setConvo((c) => [...c, { role: "assistant", content: out.text || t("(no answer)", "(응답 없음)"), cites: out.cites || [] }]);
        setPartial("");
        setThinking("");
      })
      .catch((e) => {
        if (myReq !== reqSeq.current) return;
        const msg = e?.message ? e.message : String(e);
        if (/unauthorized|401/i.test(msg)) {
          setSetOpen(true);
          setError(t("Check your key/token in settings (⚙).", "설정(⚙)에서 키/토큰을 확인하세요."));
        } else {
          setError(t("Request failed: ", "요청 실패: ") + msg);
        }
      })
      .finally(() => {
        if (myReq !== reqSeq.current) return;
        if (tick.current) clearInterval(tick.current);
        askStart.current = 0;
        setBusy(false);
      });
  }

  function saveSettings() {
    lsset(LS_PROV, provider);
    lsset(keyLS(provider), fKey.trim());
    lsset(modelLS(provider), fModel);
    if (PROVIDERS[provider].needsUrl) lsset(urlLS(provider), fUrl.trim());
    setModel(fModel);
    setSetOpen(false);
    setError("");
  }

  function toggleLang() {
    const next = !ko;
    setKo(next);
    lsset(LS_LANG, next ? "ko" : "en");
  }

  const prov = PROVIDERS[provider];
  const modelOptions =
    provider === "bot"
      ? { cloud: prov.cloudModels || [], local: botModels || prov.models || [] }
      : null;

  return (
    <div className="ask">
      {/* header */}
      <div className="ask-hd">
        <div className="ask-title">
          <b>{t("Ask Repo Lens", "Repo Lens에게 질문")}</b>
          <span className="ask-model">
            {t("model: ", "모델: ")}
            <b>{mlabel(model || prov.defModel)}</b>
          </span>
        </div>
        <button className="icon-btn" title={t("Language", "언어")} onClick={toggleLang}>
          {ko ? "한" : "EN"}
        </button>
        <button className="icon-btn" title={t("New chat", "새 대화")} onClick={clearChat}>
          🗑
        </button>
        <button className="icon-btn" title={t("Settings", "설정")} onClick={() => setSetOpen((s) => !s)}>
          ⚙
        </button>
      </div>

      {/* settings */}
      {setOpen && (
        <div className="ask-set">
          {hasBackend ? (
            <>
              <p className="ask-note">
                {t(
                  "Connected to the analysis backend — pick a model next to the Ask button. No API key needed.",
                  "분석 백엔드에 연결됨 — Ask 버튼 옆에서 모델을 고르세요. API 키는 필요 없습니다."
                )}
              </p>
              <div className="ask-row">
                <button className="ask-go" onClick={() => setSetOpen(false)}>{t("Close", "닫기")}</button>
              </div>
            </>
          ) : (
          <>
          <label>{t("Provider", "프로바이더")}</label>
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              lsset(LS_PROV, e.target.value);
            }}
          >
            {Object.keys(PROVIDERS).map((p) => (
              <option key={p} value={p}>
                {PROVIDERS[p].label}
              </option>
            ))}
          </select>

          {prov.needsUrl && (
            <>
              <label>{t("Server URL", "서버 URL")}</label>
              <input value={fUrl} onChange={(e) => setFUrl(e.target.value)} placeholder="https://…" />
            </>
          )}
          <label>{prov.needsUrl ? t("Access token (optional)", "접근 토큰 (선택)") : t("API key", "API 키")}</label>
          <input type="password" value={fKey} onChange={(e) => setFKey(e.target.value)} placeholder="…" />

          <label>{t("Model", "모델")}</label>
          <select value={fModel} onChange={(e) => setFModel(e.target.value)}>
            {modelOptions ? (
              <>
                <optgroup label={t("Claude — cloud (subscription)", "Claude — 클라우드")}>
                  {modelOptions.cloud.map((m) => (
                    <option key={m} value={m}>
                      {mlabel(m)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("Local — gateway (free)", "로컬 — 게이트웨이")}>
                  {modelOptions.local.map((m) => (
                    <option key={m} value={m}>
                      {mlabel(m)}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              (prov.models || []).map((m) => (
                <option key={m} value={m}>
                  {mlabel(m)}
                </option>
              ))
            )}
          </select>

          <div className="ask-row">
            <button className="ask-go" onClick={saveSettings}>
              {t("Save", "저장")}
            </button>
          </div>
          <p className="ask-note">
            {t(
              "Keys are stored only in this browser (localStorage). The default bot only accepts the deployed site's origin — on localhost, pick a 'your API key' provider.",
              "키는 이 브라우저(localStorage)에만 저장됩니다. 기본 봇은 배포 사이트 origin만 허용하므로 localhost에서는 'your API key' 프로바이더를 선택하세요."
            )}
          </p>
          <p className="ask-note" style={{ color: "var(--amber)" }}>
            {t(
              "Privacy: asking a question sends the file tree, README, and the open file's content to the selected provider/bot. For confidential code, use a provider you trust (the default bot is the company gateway).",
              "주의: 질문 시 파일 트리·README·열린 파일 내용이 선택한 프로바이더/봇으로 전송됩니다. 기밀 코드는 신뢰하는 프로바이더를 쓰세요(기본 봇은 사내 게이트웨이)."
            )}
          </p>
          </>
          )}
        </div>
      )}

      {/* quick actions */}
      <div className="ask-quick">
        <button className="ask-chip" disabled={!ctx.activeFile} onClick={() => ctx.activeFile && send((ko ? "이 파일이 하는 일과 핵심 함수, 레포에서의 역할을 설명해줘: " : "Explain what this file does, its key functions, and its role in the repo: ") + "`" + ctx.activeFile.path + "`")}>
          {t("Explain file", "이 파일 설명")}
        </button>
        <button className="ask-chip" disabled={!ctx.repoRef} onClick={() => send(ko ? "이 레포의 목적, 주요 구성요소, 그것들이 어떻게 연결되는지 개괄해줘." : "Give a high-level overview of this repo: its purpose, main components, and how they connect.")}>
          {t("Summarize repo", "레포 요약")}
        </button>
        <button className="ask-chip" disabled={!ctx.repoRef} onClick={() => send(ko ? "import 관계를 바탕으로 가장 중요한 모듈과 의존 흐름을 설명해줘." : "Based on the imports, what are the most important modules and how do they depend on each other?")}>
          {t("Trace flow", "연결 추적")}
        </button>
      </div>

      {/* context line */}
      <div className="ask-ctx">
        {ctx.activeFile ? (
          <>
            {t("context: ", "컨텍스트: ")}
            <code>{ctx.activeFile.path}</code> + {t("tree + README", "트리 + README")}
          </>
        ) : ctx.repoRef ? (
          <>{t("context: tree + README", "컨텍스트: 트리 + README")}</>
        ) : (
          t("no repo loaded", "레포 미로드")
        )}
      </div>

      {/* thread */}
      <div className="ask-body">
        <div className="ask-thread" ref={threadRef}>
          {convo.length === 0 && !busy && (
            <div className="ask-empty">
              {t(
                "Ask anything about this repository — follow-ups keep context.",
                "이 레포에 대해 무엇이든 물어보세요 — 후속 질문은 맥락이 이어집니다."
              )}
            </div>
          )}
          {convo.map((m, i) => {
            if (m.role === "divider")
              return (
                <div className="ask-divider" key={i}>
                  ⇄ {mlabel(m.from || "")} → {mlabel(m.to || "")}
                </div>
              );
            if (m.role === "user")
              return (
                <div className="ask-msg ask-u" key={i}>
                  {m.content}
                </div>
              );
            return (
              <div className="ask-msg ask-b" key={i}>
                <div className="ask-md" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content || "", ctx.resolvePath) }} />
                {m.cites && m.cites.length > 0 && (
                  <div className="ask-src">
                    <div>{t("Sources:", "출처:")}</div>
                    {m.cites
                      .filter((c, idx, arr) => arr.findIndex((x) => x.url === c.url) === idx)
                      .map((c, idx) => (
                        <a key={idx} href={c.url} target="_blank" rel="noopener noreferrer">
                          • {c.title}
                        </a>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <div className="ask-msg ask-b">
              {partial.trim() ? (
                <div className="ask-md">
                  <span dangerouslySetInnerHTML={{ __html: mdToHtml(partial, ctx.resolvePath) }} />
                  <span className="ask-cursor">▍</span>
                </div>
              ) : thinking.trim() ? (
                <>
                  <span className="ask-think">
                    💭 {t("reasoning", "추론 중")}
                    {elapsed ? ` · ${elapsed}s` : ""}
                  </span>
                  <div className="ask-reason">
                    {thinking.length > 600 ? "…" + thinking.slice(-600) : thinking}
                    <span className="ask-cursor">▍</span>
                  </div>
                </>
              ) : (
                <span className="ask-think">
                  {t("Thinking", "생각 중")}
                  {elapsed ? ` · ${elapsed}s` : ""} <span className="ask-dots">•••</span>
                </span>
              )}
            </div>
          )}
        </div>
        {error && <div className="ask-err">{error}</div>}
      </div>

      {/* footer */}
      <div className="ask-foot">
        <textarea
          className="ask-ta"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("Ask about this repo…", "이 레포에 대해 물어보세요…")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!busy) send(input);
            }
          }}
        />
        <div className="ask-row">
          <button className={"ask-go" + (busy ? " stop" : "")} onClick={() => (busy ? stopGen() : send(input))}>
            {busy ? t("Stop", "중단") : t("Ask", "물어보기")}
          </button>
          {hasBackend && ctx.repoRef && beModels && (beModels.cloud.length > 0 || beModels.local.length > 0) && (
            <select className="ask-msel" value={model} onChange={(e) => pickModel(e.target.value)} title={t("model", "모델")}>
              {beModels.cloud.length > 0 && (
                <optgroup label={t("Claude — cloud", "Claude — 클라우드")}>
                  {beModels.cloud.map((m) => (
                    <option key={m} value={m}>{mlabel(m)}</option>
                  ))}
                </optgroup>
              )}
              {beModels.local.length > 0 && (
                <optgroup label={t("Local — gateway (free)", "로컬 — 게이트웨이")}>
                  {beModels.local.map((m) => (
                    <option key={m} value={m}>{mlabel(m)}</option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
          <div className="ask-chks">
            <label className="ask-chk">
              <input
                type="checkbox"
                checked={web}
                onChange={(e) => {
                  setWeb(e.target.checked);
                  lsset(LS_WEB, e.target.checked ? "1" : "0");
                }}
              />
              {t("web search", "웹 검색")}
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
