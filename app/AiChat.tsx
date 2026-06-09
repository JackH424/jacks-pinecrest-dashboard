"use client";

import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function AiChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const data = await r.json();
      setMessages((m) => [...m, { role: "assistant", content: data.reply || "Done." }]);
      if (data.changed) setTimeout(() => window.location.reload(), 900);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="lbl">◈ AI Assistant — say what happened and it&apos;ll create/update tasks &amp; projects.</div>
      {messages.length > 0 && (
        <div className="chat-msgs">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="chat-msg assistant">…</div>}
          <div ref={endRef} />
        </div>
      )}
      <textarea
        placeholder='e.g. "Got off the Aetna call — create a task in WC Carrier Appointments: follow up with Ascot, assign Casey, due Friday."'
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="row">
        <span className="hint">Enter to send · Shift+Enter for new line{busy ? " · working…" : ""}</span>
        <button className="btn-primary" onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
