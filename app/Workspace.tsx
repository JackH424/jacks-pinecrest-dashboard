"use client";

import { useMemo, useState, useTransition } from "react";
import type { Workspace as WS, Task, Comment } from "@/lib/data";
import { TEAM, TEAM_SET } from "@/lib/team";
import { setStatus, toggleAssignee, moveTask, addComment } from "./actions";

type View = "projects" | "tasks" | "people" | "messages";
type SF = "open" | "all" | "done";

function parseMentions(body: string): string[] {
  return Array.from(new Set((body.match(/@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g) || []).map((m) => m.slice(1))));
}
function Body({ text }: { text: string }) {
  const parts = text.split(/(@[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g);
  return <>{parts.map((p, i) => (p.startsWith("@") ? <strong key={i} className="mention">{p}</strong> : <span key={i}>{p}</span>))}</>;
}

export default function Workspace({ data, primaryUser, persists }: { data: WS; primaryUser: string; persists: boolean }) {
  const [, start] = useTransition();
  const [tasks, setTasks] = useState<Task[]>(data.tasks);
  const [comments, setComments] = useState<Comment[]>(data.comments);
  const [view, setView] = useState<View>("projects");
  const [selProj, setSelProj] = useState<string | null>(null);
  const [selPerson, setSelPerson] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<SF>("open");
  const [assignee, setAssignee] = useState("");

  const idByName = useMemo(() => new Map(data.people.map((p) => [p.name, p.id])), [data.people]);
  const projName = useMemo(() => new Map(data.projects.map((p) => [p.id, p.name])), [data.projects]);
  const projStats = useMemo(() => {
    const m = new Map<string, { total: number; open: number }>();
    tasks.forEach((t) => { const s = m.get(t.project_id) ?? { total: 0, open: 0 }; s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s); });
    return m;
  }, [tasks]);
  const personOpen = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => { if (t.status !== "done") t.assignees.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)); });
    return m;
  }, [tasks]);
  const commentsFor = (type: string, id: string) =>
    comments.filter((c) => c.target_type === type && c.target_id === id)
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const myMessages = useMemo(
    () => comments.filter((c) => (c.mentions || []).includes(primaryUser))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [comments, primaryUser]
  );

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      if (selProj && t.project_id !== selProj) return false;
      if (selPerson && !t.assignees.includes(selPerson)) return false;
      if (assignee && !t.assignees.includes(assignee)) return false;
      if (sf === "open" && t.status === "done") return false;
      if (sf === "done" && t.status !== "done") return false;
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [tasks, selProj, selPerson, assignee, sf, q]);

  function patch(id: string, fn: (t: Task) => Task) { setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t))); }
  function cycle(t: Task) { const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo"; patch(t.id, (x) => ({ ...x, status: next })); if (persists) start(() => { setStatus(t.id, next); }); }
  function addA(t: Task, name: string) { if (!name || t.assignees.includes(name)) return; const pid = idByName.get(name); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: [...x.assignees, name].sort() })); if (persists) start(() => { toggleAssignee(t.id, pid, true); }); }
  function rmA(t: Task, name: string) { const pid = idByName.get(name); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: x.assignees.filter((a) => a !== name) })); if (persists) start(() => { toggleAssignee(t.id, pid, false); }); }
  function move(t: Task, pid: string) { patch(t.id, (x) => ({ ...x, project_id: pid })); if (persists) start(() => { moveTask(t.id, pid); }); }
  function post(type: "task" | "project", id: string, body: string) {
    const text = body.trim(); if (!text) return;
    const c: Comment = { id: "tmp" + Math.random().toString(36).slice(2), target_type: type, target_id: id, author: primaryUser, body: text, created_at: new Date().toISOString().slice(0, 19), mentions: parseMentions(text) };
    setComments((cs) => [...cs, c]);
    if (persists) start(() => { addComment(type, id, primaryUser, text); });
  }
  function switchView(v: View) { setView(v); setSelProj(null); setSelPerson(null); setAssignee(""); }

  const showingCards = (view === "projects" && !selProj) || (view === "people" && !selPerson);
  const heading = selProj ? projName.get(selProj) : selPerson;
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) : null;

  return (
    <>
      <div className="seg">
        <button className={view === "projects" ? "on" : ""} onClick={() => switchView("projects")}>Projects</button>
        <button className={view === "tasks" ? "on" : ""} onClick={() => switchView("tasks")}>Tasks</button>
        <button className={view === "people" ? "on" : ""} onClick={() => switchView("people")}>People</button>
        <button className={view === "messages" ? "on" : ""} onClick={() => switchView("messages")}>Messages{myMessages.length ? ` (${myMessages.length})` : ""}</button>
      </div>

      {view === "messages" && (
        <div className="msglist">
          {myMessages.length === 0 ? <div className="empty">No messages mention you yet.</div> :
            myMessages.map((c) => (
              <div key={c.id} className="msg">
                <div className="msg-h"><b>{c.author}</b> in <span className="src">{projName.get(c.target_id) || c.target_id}</span> · {c.created_at?.replace("T", " ")}</div>
                <div className="msg-b"><Body text={c.body} /></div>
              </div>
            ))}
        </div>
      )}

      {view !== "messages" && showingCards && view === "projects" && (
        <div className="cards">
          {data.projects.map((p) => {
            const s = projStats.get(p.id) ?? { total: 0, open: 0 };
            const pct = s.total ? Math.round(((s.total - s.open) / s.total) * 100) : 0;
            return (
              <div key={p.id} className="card" onClick={() => setSelProj(p.id)}>
                <div className="name">{p.name}</div>
                <div className="meta">{s.open} open / {s.total} · {p.members.length} ppl</div>
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
      {view !== "messages" && showingCards && view === "people" && (
        <div className="cards">
          {data.people.filter((p) => TEAM_SET.has(p.name)).sort((a, b) => (personOpen.get(b.name) ?? 0) - (personOpen.get(a.name) ?? 0))
            .map((p) => (
              <div key={p.id} className="card" onClick={() => setSelPerson(p.name)}>
                <div className="name">{p.name}{p.name === primaryUser ? " (me)" : ""}</div>
                <div className="meta"><span className="big">{personOpen.get(p.name) ?? 0}</span> open</div>
              </div>
            ))}
        </div>
      )}

      {view !== "messages" && !showingCards && (
        <>
          {heading && (
            <div className="crumb">
              <button className="clear" onClick={() => { setSelProj(null); setSelPerson(null); }}>← Back to {view === "projects" ? "projects" : "people"}</button>
              <h2>{heading}</h2>
            </div>
          )}
          <div className="controls">
            <div className="statustabs">
              <button className={sf === "open" ? "on" : ""} onClick={() => setSf("open")}>Open</button>
              <button className={sf === "all" ? "on" : ""} onClick={() => setSf("all")}>All</button>
              <button className={sf === "done" ? "on" : ""} onClick={() => setSf("done")}>Done</button>
            </div>
            {view === "tasks" && (
              <select className="streamsel" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Anyone</option>
                {TEAM.map((n) => <option key={n} value={n}>{n} ({personOpen.get(n) ?? 0})</option>)}
              </select>
            )}
            <span className="spacer" />
            <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {rows.length === 0 ? <div className="empty">No tasks match.</div> : (
            <div className="tasklist">
              {rows.slice(0, 300).map((t) => (
                <div key={t.id} className={`tcard ${t.status === "done" ? "done" : ""}`}>
                  <div className="tcard-top">
                    <span className={`badge ${t.status}`} onClick={() => cycle(t)}>{t.status}</span>
                    <select className="proj-pick" value={t.project_id} onChange={(e) => move(t, e.target.value)}>
                      {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="tcard-title">{t.title}</div>
                  <div className="chips">
                    {t.assignees.map((a) => <span key={a} className="who" onClick={() => rmA(t, a)} title="remove">{a} ×</span>)}
                    <select className="streamsel" value="" onChange={(e) => { addA(t, e.target.value); e.currentTarget.value = ""; }}>
                      <option value="">+ assign…</option>
                      {TEAM.filter((n) => !t.assignees.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="tcard-foot">
                    <button className="linkbtn" onClick={() => setOpenTaskId(t.id)}>💬 Discuss{commentsFor("task", t.id).length ? ` (${commentsFor("task", t.id).length})` : ""}</button>
                    {t.source_url && <> · <a className="src" href={t.source_url} target="_blank" rel="noreferrer">source</a></>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {rows.length > 300 && <p className="note">Showing first 300 of {rows.length} — filter or search.</p>}

          {/* Project discussion thread */}
          {selProj && (
            <div className="thread">
              <h3>Project discussion</h3>
              <Thread items={commentsFor("project", selProj)} onPost={(b) => post("project", selProj!, b)} />
            </div>
          )}
        </>
      )}

      {/* Task detail modal */}
      {openTask && (
        <div className="overlay" onClick={() => setOpenTaskId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div>
                <span className={`badge ${openTask.status}`} onClick={() => cycle(openTask)}>{openTask.status}</span>
                <span className="src" style={{ marginLeft: 8 }}>{projName.get(openTask.project_id)}</span>
              </div>
              <button className="clear" onClick={() => setOpenTaskId(null)}>✕</button>
            </div>
            <h2 className="modal-title">{openTask.title}</h2>
            <div className="chips" style={{ marginBottom: 10 }}>
              {openTask.assignees.map((a) => <span key={a} className="who" onClick={() => rmA(openTask, a)}>{a} ×</span>)}
              <select className="streamsel" value="" onChange={(e) => { addA(openTask, e.target.value); e.currentTarget.value = ""; }}>
                <option value="">+ assign…</option>
                {TEAM.filter((n) => !openTask.assignees.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <Thread items={commentsFor("task", openTask.id)} onPost={(b) => post("task", openTask.id, b)} />
          </div>
        </div>
      )}
    </>
  );
}

function Thread({ items, onPost }: { items: Comment[]; onPost: (body: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="threadbox">
      <div className="comments">
        {items.length === 0 ? <div className="src">No messages yet.</div> :
          items.map((c) => (
            <div key={c.id} className="comment">
              <div className="c-h"><b>{c.author}</b> <span className="src">{c.created_at?.replace("T", " ")}</span></div>
              <div className="c-b"><Body text={c.body} /></div>
            </div>
          ))}
      </div>
      <div className="composer">
        <textarea placeholder="Write a message… use @Name to ping someone" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="post" onClick={() => { onPost(text); setText(""); }} disabled={!text.trim()}>Post</button>
      </div>
    </div>
  );
}
