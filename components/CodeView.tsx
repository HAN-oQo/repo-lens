"use client";

import dynamic from "next/dynamic";
import { monacoLang } from "@/lib/lang";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="placeholder">
      <span className="spin" />
    </div>
  ),
});

export default function CodeView({
  path,
  content,
  loading,
}: {
  path: string;
  content: string | undefined;
  loading: boolean;
}) {
  if (loading || content === undefined) {
    return (
      <div className="placeholder">
        <span className="spin" />
      </div>
    );
  }
  return (
    <MonacoEditor
      key={path}
      height="100%"
      theme="vs-dark"
      language={monacoLang(path)}
      value={content}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: true },
        fontSize: 13,
        fontFamily: "var(--mono)",
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        smoothScrolling: true,
        automaticLayout: true,
        wordWrap: "off",
      }}
    />
  );
}
