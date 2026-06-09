"use client";

import { useMemo, useState, useTransition } from "react";
import type { Workspace as WS, Task, Comment } from "@/lib/data";
import { TEAM, TEAM_SET } from "@/lib/team";
import { STATUSES, ONEOFF_ID } from "@/lib/statuses";
import { setStatus, toggleAssignee, moveTask, addComment, addTask, renameProject, updateTaskTitle } from "./actions";

type View = "dashboard" | "project" | "person" | "tasks" | "messages" | "calendar" | "transcripts" | "decisions" | "vendors";
const STUBS: Record<string, string> = { calendar: "Calendar", transcripts: "Transcripts", decisions: "Decision Log", vendors: "Vendors" };
type SF = "open" | "all" | "done";
const PCOLORS = ["#c2702f", "#2f8f87", "#3a4a78", "#7a4a78", "#5c7a4a", "#a8852f", "#b3422f", "#2f6fb0", "#6b3fa0", "#2f7a4a"];

function parseMentions(b: string): string[] { return Array.from(new Set((b.match(/@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g) || []).map((m) => m.slice(1)))); }
function Body({ text }: { text: string }) {
  const parts = text.split(/(@[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g);
  return <>{parts.map((p, i) => (p.startsWith("@") ? <strong key={i} className="mention">{p}</strong> : <span key={i}>{p}</span>))}</>;
}

export default function Workspace({ data, primaryUser, persists }: { data: WS; primaryUser: string; persists: boolean }) {
  const [, start] = useTransition();
  const [tasks, setTasks] = useState<Task[]>(data.tasks);
  const [comments, setComments] = useState<Comment[]>(data.comments);
  const [projOverride, setProjOverride] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("dashboard");
  const [selProj, setSelProj] = useState<string | null>(null);
  const [selPerson, setSelPerson] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<SF>("open");
  const [assignee, setAssignee] = useState("");
  const [sortBy, setSortBy] = useState<"none" | "project" | "status">("none");
  const [adding, setAdding] = useState(false);
  const [ntTitle, setNtTitle] = useState("");
  const [ntWho, setNtWho] = useState("");
  const [dump, setDump] = useState("");
  const [peopleFilter, setPeopleFilter] = useState<string[]>([]);
  function togglePerson(n: string) { setPeopleFilter((f) => f.includes(n) ? f.filter((x) => x !== n) : [...f, n]); }

  const idByName = useMemo(() => new Map(data.people.map((p) => [p.name, p.id])), [data.people]);
  const baseProjName = useMemo(() => new Map(data.projects.map((p) => [p.id, p.name])), [data.projects]);
  const projName = (id: string) => projOverride[id] ?? baseProjName.get(id) ?? id;
  const projColor = useMemo(() => { const m = new Map<string, string>(); data.projects.forEach((p, i) => m.set(p.id, PCOLORS[i % PCOLORS.length])); return m; }, [data.projects]);

  const projStats = useMemo(() => { const m = new Map<string, { total: number; open: number }>(); tasks.forEach((t) => { const s = m.get(t.project_id) ?? { total: 0, open: 0 }; s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s); }); return m; }, [tasks]);
  const personOpen = useMemo(() => { const m = new Map<string, number>(); tasks.forEach((t) => { if (t.status !== "done") t.assignees.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)); }); return m; }, [tasks]);
  const dashTasks = useMemo(() => peopleFilter.length === 0 ? tasks : tasks.filter((t) => t.assignees.some((a) => peopleFilter.includes(a))), [tasks, peopleFilter]);
  const counts = useMemo(() => ({ open: dashTasks.filter((t) => t.status !== "done").length, inprog: dashTasks.filter((t) => t.status === "in_progress").length, blocked: dashTasks.filter((t) => t.status === "blocked").length, done: dashTasks.filter((t) => t.status === "done").length }), [dashTasks]);
  const dashProjStats = useMemo(() => { const m = new Map<string, { total: number; open: number }>(); dashTasks.forEach((t) => { const s = m.get(t.project_id) ?? { total: 0, open: 0 }; s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s); }); return m; }, [dashTasks]);
  const commentsFor = (type: string, id: string) => comments.filter((c) => c.target_type === type && c.target_id === id).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const myMessages = useMemo(() => comments.filter((c) => (c.mentions || []).includes(primaryUser)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), [comments, primaryUser]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      if (view === "project" && selProj && t.project_id !== selProj) return false;
      if (view === "person" && selPerson && !t.assignees.includes(selPerson)) return false;
      if (assignee && !t.assignees.includes(assignee)) return false;
      if (sf === "open" && t.status === "done") return false;
      if (sf === "done" && t.status !== "done") return false;
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [tasks, view, selProj, selPerson, assignee, sf, q]);

  const STATUS_ORDER: Record<string, number> = { todo: 0, in_progress: 1, waiting: 2, blocked: 3, done: 4 };
  const sortedRows = useMemo(() => {
    if (sortBy === "none") return rows;
    const r = [...rows];
    if (sortBy === "project") r.sort((a, b) => projName(a.project_id).localeCompare(projName(b.project_id)));
    else r.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    return r;
  }, [rows, sortBy, projOverride]);

  function patch(id: string, fn: (t: Task) => Task) { setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t))); }
  function changeStatus(t: Task, status: string) { patch(t.id, (x) => ({ ...x, status })); if (persists) start(() => { setStatus(t.id, status); }); }
  function toggleDone(t: Task) { changeStatus(t, t.status === "done" ? "todo" : "done"); }
  function addA(t: Task, n: string) { if (!n || t.assignees.includes(n)) return; const pid = idByName.get(n); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: [...x.assignees, n].sort() })); if (persists) start(() => { toggleAssignee(t.id, pid, true); }); }
  function rmA(t: Task, n: string) { const pid = idByName.get(n); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: x.assignees.filter((a) => a !== n) })); if (persists) start(() => { toggleAssignee(t.id, pid, false); }); }
  function move(t: Task, pid: string) { patch(t.id, (x) => ({ ...x, project_id: pid })); if (persists) start(() => { moveTask(t.id, pid); }); }
  function post(type: "task" | "project", id: string, body: string) { const text = body.trim(); if (!text) return; const c: Comment = { id: "tmp" + Math.random().toString(36).slice(2), target_type: type, target_id: id, author: primaryUser, body: text, created_at: new Date().toISOString().slice(0, 19), mentions: parseMentions(text) }; setComments((cs) => [...cs, c]); if (persists) start(() => { addComment(type, id, primaryUser, text); }); }
  function renameProj(id: string, name: string) { const n = name.trim(); if (!n) return; setProjOverride((o) => ({ ...o, [id]: n })); if (persists) start(() => { renameProject(id, n); }); }
  function retitle(t: Task, title: string) { const n = title.trim(); if (!n) return; patch(t.id, (x) => ({ ...x, title: n })); if (persists) start(() => { updateTaskTitle(t.id, n); }); }
  function createTaskRaw(title: string, proj: string, whoName: string) {
    const id = "tmp" + Math.random().toString(36).slice(2);
    setTasks((ts) => [{ id, project_id: proj, title, status: "todo", priority: "normal", due: "", source_type: "manual", source_title: proj === ONEOFF_ID ? "One-off" : "", source_date: "", source_url: "", assignees: whoName ? [whoName] : [] }, ...ts]);
    if (persists) start(() => { addTask(title, proj, whoName ? [idByName.get(whoName) || ""] : []); });
  }
  function submitForm() { const t = ntTitle.trim(); if (!t) return; createTaskRaw(t, selProj || ONEOFF_ID, ntWho); setNtTitle(""); setNtWho(""); setAdding(false); }
  function sendDump() { dump.split("\n").map((s) => s.trim()).filter(Boolean).forEach((l) => createTaskRaw(l, ONEOFF_ID, "")); setDump(""); }

  function goProject(id: string) { setView("project"); setSelProj(id); setSelPerson(null); }
  function goPerson(n: string) { setView("person"); setSelPerson(n); setSelProj(null); }
  function goView(v: View) { setView(v); setSelProj(null); setSelPerson(null); setAssignee(""); setAdding(false); }

  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) : null;
  const dashProjects = data.projects.filter((p) => (dashProjStats.get(p.id)?.open ?? 0) > 0).sort((a, b) => (dashProjStats.get(b.id)?.open ?? 0) - (dashProjStats.get(a.id)?.open ?? 0));

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">pinecrest<span className="af">.hq</span></div>
        <div className="side-h">OVERVIEW</div>
        <nav className="sidenav">
          <button className={`navlink ${view === "dashboard" ? "on" : ""}`} onClick={() => goView("dashboard")}>Dashboard</button>
          <button className={`navlink ${view === "tasks" ? "on" : ""}`} onClick={() => goView("tasks")}>All tasks</button>
          <button className={`navlink ${view === "messages" ? "on" : ""}`} onClick={() => goView("messages")}>Messages {myMessages.length ? <span className="ct">{myMessages.length}</span> : null}</button>
        </nav>
        <div className="side-sec">
          <div className="side-h">PROJECTS</div>
          {data.projects.map((p) => (
            <div key={p.id} className={`side-item ${selProj === p.id ? "on" : ""}`} onClick={() => goProject(p.id)}>
              <span className="dot" style={{ background: projColor.get(p.id) }} />
              <span className="nm">{projName(p.id)}</span>
              <span className="ct">{projStats.get(p.id)?.open ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="side-sec">
          <div className="side-h">PEOPLE</div>
          {data.people.filter((p) => TEAM_SET.has(p.name)).sort((a, b) => (personOpen.get(b.name) ?? 0) - (personOpen.get(a.name) ?? 0)).map((p) => (
            <div key={p.id} className={`side-item ${selPerson === p.name ? "on" : ""}`} onClick={() => goPerson(p.name)}>
              <span className="nm">{p.name}{p.name === primaryUser ? " (me)" : ""}</span>
              <span className="ct">{personOpen.get(p.name) ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="side-sec">
          <div className="side-h">LOGS</div>
          <div className="side-item" onClick={() => goView("transcripts")}><span className="nm">Transcripts</span></div>
          <div className="side-item" onClick={() => goView("decisions")}><span className="nm">Decision Log</span></div>
          <div className="side-item" onClick={() => goView("vendors")}><span className="nm">Vendors</span></div>
        </div>
        <div className="side-foot">
          <div className="gcal"><span className="dot" style={{ background: "var(--sage)" }} /> Google Calendar</div>
          <div className="gcal-sub">Connect later</div>
        </div>
      </aside>

      <div className="main-area">
        <div className="topbar">
          <input className="topsearch" placeholder="Search everything…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) goView("tasks"); }} />
          <nav className="tabs">
            {(["dashboard", "calendar", "transcripts", "decisions", "vendors"] as View[]).map((v) => (
              <button key={v} className={`tab ${view === v ? "on" : ""}`} onClick={() => goView(v)}>{v === "dashboard" ? "Dashboard" : STUBS[v]}</button>
            ))}
          </nav>
        </div>
        <main className="content">
        {(view in STUBS) && (
          <div className="stub">
            <div className="page-h">{STUBS[view]}</div>
            <div className="empty">{STUBS[view]} is planned — not built yet. Tell me to prioritize it and I&apos;ll wire it up.</div>
          </div>
        )}
        {view === "dashboard" && (
          <div className="dash-grid">
            <div>
            <div className="page-h">Dashboard</div>
            <div className="pfilter">
              <span className="pfilter-l">Filter by person:</span>
              <button className={`pchip ${peopleFilter.length === 0 ? "on" : ""}`} onClick={() => setPeopleFilter([])}>Everyone</button>
              {TEAM.map((n) => (
                <button key={n} className={`pchip ${peopleFilter.includes(n) ? "on" : ""}`} onClick={() => togglePerson(n)}>{n}</button>
              ))}
            </div>
            <div className="dump">
              <div className="lbl">◈ AI Assistant — dump tasks, one per line. <span className="hint">(AI parsing &amp; routing comes later via Hermes.)</span></div>
              <textarea placeholder="Dump tasks, notes, or anything…" value={dump} onChange={(e) => setDump(e.target.value)} />
              <div className="row"><span className="hint">Enter to send · Shift+Enter new line</span><button className="btn-primary" onClick={sendDump} disabled={!dump.trim()}>Send</button></div>
            </div>
            <div className="stats">
              <div className="stat"><div className="n s-open">{counts.open}</div><div className="l">Open</div></div>
              <div className="stat"><div className="n s-prog">{counts.inprog}</div><div className="l">In progress</div></div>
              <div className="stat"><div className="n s-blocked">{counts.blocked}</div><div className="l">Blocked</div></div>
              <div className="stat"><div className="n s-done">{counts.done}</div><div className="l">Done</div></div>
            </div>
            <div className="section-h">Projects</div>
            <div className="columns">
              {dashProjects.map((p) => {
                const s = dashProjStats.get(p.id) ?? { total: 0, open: 0 };
                const pct = s.total ? Math.round(((s.total - s.open) / s.total) * 100) : 0;
                const open = dashTasks.filter((t) => t.project_id === p.id && t.status !== "done").slice(0, 7);
                const more = s.open - open.length;
                return (
                  <div key={p.id} className="col">
                    <div className="col-h" onClick={() => goProject(p.id)}>
                      <span className="dot" style={{ background: projColor.get(p.id) }} />
                      <span className="nm">{projName(p.id)}</span>
                      <span className="all">All</span>
                    </div>
                    {open.map((t) => (
                      <div key={t.id} className={`row-t ${t.status === "done" ? "done" : ""}`}>
                        <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                        <span onClick={() => setOpenTaskId(t.id)} style={{ cursor: "pointer", flex: 1 }}>{t.title}</span>
                      </div>
                    ))}
                    {more > 0 && <div className="row-t" style={{ color: "var(--lo)", cursor: "pointer" }} onClick={() => goProject(p.id)}>+{more} more</div>}
                    <div className="miniadd" onClick={() => goProject(p.id)}>+ add</div>
                    <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                    <div className="progress">{s.total - s.open}/{s.total} done</div>
                  </div>
                );
              })}
            </div>
            </div>
            <aside className="rail">
              <div className="rail-card"><div className="rail-h">REMINDERS TODAY</div><div className="empty-rail">🔔 No reminders today</div></div>
              <div className="rail-card"><div className="rail-h">UPCOMING</div><div className="empty-rail">Nothing upcoming</div></div>
            </aside>
          </div>
        )}

        {view === "messages" && (
          <>
            <div className="page-h">Messages</div>
            <div className="msglist">
              {myMessages.length === 0 ? <div className="empty">No messages mention you yet.</div> :
                myMessages.map((c) => (
                  <div key={c.id} className="msg">
                    <div className="msg-h"><b>{c.author}</b> in <span className="src">{projName(c.target_id) || c.target_id}</span> · {c.created_at?.replace("T", " ")}</div>
                    <div className="msg-b"><Body text={c.body} /></div>
                  </div>
                ))}
            </div>
          </>
        )}

        {(view === "project" || view === "person" || view === "tasks") && (
          <>
            {view === "project" && selProj && (
              <div className="phead">
                <button className="clear" onClick={() => goView("dashboard")}>← Dashboard</button>
                <div className="plabel">PROJECT</div>
                <Editable className="ptitle" value={projName(selProj)} onSave={(n) => renameProj(selProj, n)} />
              </div>
            )}
            {view === "person" && selPerson && (
              <div className="phead">
                <button className="clear" onClick={() => goView("dashboard")}>← Dashboard</button>
                <div className="plabel">PERSON</div>
                <div className="ptitle">{selPerson}</div>
              </div>
            )}
            {view === "tasks" && <div className="page-h">All tasks</div>}

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
              {(view === "person" || view === "tasks") && (
                <select className="streamsel" value={sortBy} onChange={(e) => setSortBy(e.target.value as "none" | "project" | "status")}>
                  <option value="none">Sort: default</option>
                  <option value="project">Sort: project</option>
                  <option value="status">Sort: status</option>
                </select>
              )}
              <span className="spacer" />
              <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="newbtn" onClick={() => setAdding((a) => !a)}>+ New task</button>
            </div>
            {adding && (
              <div className="newform">
                <input autoFocus placeholder="Task title…" value={ntTitle} onChange={(e) => setNtTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitForm(); }} />
                <select className="streamsel" value={ntWho} onChange={(e) => setNtWho(e.target.value)}>
                  <option value="">Unassigned</option>
                  {TEAM.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <button className="btn-primary" onClick={submitForm} disabled={!ntTitle.trim()}>Add{selProj ? " to project" : " (one-off)"}</button>
              </div>
            )}

            {sortedRows.length === 0 ? <div className="empty">No tasks match.</div> : (
              <div className="tasklist">
                {sortedRows.slice(0, 300).map((t) => (
                  <div key={t.id} className={`tcard ${t.status === "done" ? "done" : ""}`}>
                    <div className="tcard-top">
                      <select className={`stk stk-${t.status}`} value={t.status} onChange={(e) => changeStatus(t, e.target.value)}>
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      {view === "tasks" ? (
                        <select className="proj-pick" value={t.project_id} onChange={(e) => move(t, e.target.value)} title="Project">
                          {data.projects.map((p) => <option key={p.id} value={p.id}>{projName(p.id)}</option>)}
                        </select>
                      ) : view !== "project" ? (
                        <span className="proj-chip" onClick={() => goProject(t.project_id)} title="Open project">{projName(t.project_id)}</span>
                      ) : null}
                    </div>
                    <div className="tcard-title">{t.project_id === ONEOFF_ID && <span className="oneoff-tag">one-off</span>}{t.title}</div>
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
            {sortedRows.length > 300 && <p className="note">Showing first 300 of {sortedRows.length} — filter or search.</p>}

            {view === "project" && selProj && (
              <div className="thread">
                <h3>Project discussion</h3>
                <Thread items={commentsFor("project", selProj)} onPost={(b) => post("project", selProj, b)} />
              </div>
            )}
          </>
        )}
        </main>
      </div>

      {openTask && (
        <div className="overlay" onClick={() => setOpenTaskId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <select className={`stk stk-${openTask.status}`} value={openTask.status} onChange={(e) => changeStatus(openTask, e.target.value)}>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <button className="clear" onClick={() => setOpenTaskId(null)}>✕</button>
            </div>
            <Editable className="modal-title" value={openTask.title} onSave={(n) => retitle(openTask, n)} />
            <div className="src" style={{ marginBottom: 10 }}>Project: {projName(openTask.project_id)}</div>
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
      <button className="logdecision" onClick={() => goView("decisions")}>⚡ Log Decision</button>
    </div>
  );
}

function Editable({ value, onSave, className }: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (editing) {
    return (<input className={`edit-input ${className || ""}`} autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { onSave(v); setEditing(false); }} onKeyDown={(e) => { if (e.key === "Enter") { onSave(v); setEditing(false); } if (e.key === "Escape") setEditing(false); }} />);
  }
  return <span className={`editable ${className || ""}`} onClick={() => { setV(value); setEditing(true); }} title="click to edit">{value} <span className="pencil">✎</span></span>;
}

function Thread({ items, onPost }: { items: Comment[]; onPost: (body: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="threadbox">
      <div className="comments">
        {items.length === 0 ? <div className="src">No messages yet.</div> :
          items.map((c) => (<div key={c.id} className="comment"><div className="c-h"><b>{c.author}</b> <span className="src">{c.created_at?.replace("T", " ")}</span></div><div className="c-b"><Body text={c.body} /></div></div>))}
      </div>
      <div className="composer">
        <textarea placeholder="Write a message… use @Name to ping" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="post" onClick={() => { onPost(text); setText(""); }} disabled={!text.trim()}>Post</button>
      </div>
    </div>
  );
}
