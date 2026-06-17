"use client";

import { useMemo, useState, useTransition, useEffect, useRef } from "react";
import type { Workspace as WS, Task, Comment, ChecklistItem, Dep, TriageItem } from "@/lib/data";
import { TEAM, TEAM_SET } from "@/lib/team";
import { STATUSES, ONEOFF_ID } from "@/lib/statuses";
import { setStatus, toggleAssignee, moveTask, addComment, addTask, renameProject, updateTaskTitle, setDue, setDescription, setPriority, setRepeat, markRead, addChecklistItem, toggleChecklistItem, deleteChecklistItem, addDep, removeDep, acceptTriage, dismissTriage } from "./actions";

const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const PRI_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
import AiChat from "./AiChat";

type View = "dashboard" | "project" | "person" | "tasks" | "messages" | "myday" | "workload" | "triage" | "calendar" | "transcripts" | "decisions" | "vendors";
const STUBS: Record<string, string> = { transcripts: "Transcripts", decisions: "Decision Log", vendors: "Vendors" };
const TABLABEL: Record<string, string> = { dashboard: "Dashboard", calendar: "Calendar", transcripts: "Transcripts", decisions: "Decision Log", vendors: "Vendors" };
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
  const [checklists, setChecklists] = useState<ChecklistItem[]>(data.checklists);
  const [deps, setDeps] = useState<Dep[]>(data.deps);
  const [triage, setTriage] = useState<TriageItem[]>(data.triage);
  const [projOverride, setProjOverride] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("dashboard");
  const [selProj, setSelProj] = useState<string | null>(null);
  const [selPerson, setSelPerson] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<SF>("open");
  const [assignee, setAssignee] = useState("");
  const [sortBy, setSortBy] = useState<"none" | "project" | "status" | "priority">("none");
  const [personMode, setPersonMode] = useState<"project" | "task">("project");
  const [layout, setLayout] = useState<"cards" | "board">("cards");
  const [calBase, setCalBase] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [adding, setAdding] = useState(false);
  const [ntTitle, setNtTitle] = useState("");
  const [ntWho, setNtWho] = useState("");
  // Viewer identity (login-lite): stored in localStorage, defaults to Jack.
  const [viewer, setViewer] = useState<string>(primaryUser);
  const [showPicker, setShowPicker] = useState(false);
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem("mc_viewer") : null;
    if (v && TEAM.includes(v)) setViewer(v);
    else setShowPicker(true);
  }, [primaryUser]);
  function pickViewer(n: string) { setViewer(n); window.localStorage.setItem("mc_viewer", n); setShowPicker(false); }

  // Live-ish updates: poll a cheap change-signature; offer a refresh when the
  // DB changed from elsewhere (a teammate or the meeting-triage cron). Changes
  // within 5s of one of this user's own edits are ignored so self-writes don't
  // nag. Non-disruptive — never auto-reloads mid-edit.
  const lastEditRef = useRef(0);
  const sigRef = useRef<string | null>(null);
  const [updatesReady, setUpdatesReady] = useState(false);
  useEffect(() => {
    if (!persists) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch("/api/pulse", { cache: "no-store" });
        const { sig } = await r.json();
        if (!sig || sig === "err") return;
        if (sigRef.current === null) { sigRef.current = sig; return; }
        if (sig !== sigRef.current) {
          if (Date.now() - lastEditRef.current > 5000) setUpdatesReady(true);
          sigRef.current = sig;
        }
      } catch { /* offline / transient — ignore */ }
    };
    tick();
    const iv = setInterval(() => { if (!document.hidden) tick(); }, 30000);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => { stop = true; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [persists]);

  const [peopleFilter, setPeopleFilter] = useState<string[]>([]);
  function togglePerson(n: string) { setPeopleFilter((f) => f.includes(n) ? f.filter((x) => x !== n) : [...f, n]); }
  const [dueFilter, setDueFilter] = useState<"any" | "overdue" | "week" | "month">("any");
  const today = new Date().toISOString().slice(0, 10);
  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const monthAhead = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  function dueClass(due: string) { if (!due) return ""; if (due < today) return "overdue"; return due <= weekAhead ? "soon" : ""; }

  const idByName = useMemo(() => new Map(data.people.map((p) => [p.name, p.id])), [data.people]);
  const baseProjName = useMemo(() => new Map(data.projects.map((p) => [p.id, p.name])), [data.projects]);
  const projName = (id: string) => projOverride[id] ?? baseProjName.get(id) ?? id;
  const projColor = useMemo(() => { const m = new Map<string, string>(); data.projects.forEach((p, i) => m.set(p.id, PCOLORS[i % PCOLORS.length])); return m; }, [data.projects]);

  const projStats = useMemo(() => { const m = new Map<string, { total: number; open: number }>(); tasks.forEach((t) => { const s = m.get(t.project_id) ?? { total: 0, open: 0 }; s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s); }); return m; }, [tasks]);
  const personOpen = useMemo(() => { const m = new Map<string, number>(); tasks.forEach((t) => { if (t.status !== "done") t.assignees.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)); }); return m; }, [tasks]);
  const dashTasks = useMemo(() => peopleFilter.length === 0 ? tasks : tasks.filter((t) => t.assignees.some((a) => peopleFilter.includes(a))), [tasks, peopleFilter]);
  const staleTasks = useMemo(() => {
    const cutoff = Date.now() - 10 * 864e5;
    return dashTasks
      .filter((t) => t.status !== "done" && t.updated_at && new Date(t.updated_at + "T00:00:00Z").getTime() < cutoff)
      .map((t) => ({ t, days: Math.floor((Date.now() - new Date(t.updated_at + "T00:00:00Z").getTime()) / 864e5) }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 7);
  }, [dashTasks]);
  const counts = useMemo(() => ({ open: dashTasks.filter((t) => t.status !== "done").length, inprog: dashTasks.filter((t) => t.status === "in_progress").length, blocked: dashTasks.filter((t) => t.status === "blocked").length, done: dashTasks.filter((t) => t.status === "done").length }), [dashTasks]);
  const dueToday = useMemo(() => dashTasks.filter((t) => t.status !== "done" && t.due && t.due <= today).sort((a, b) => a.due.localeCompare(b.due)), [dashTasks, today]);
  const upcoming = useMemo(() => dashTasks.filter((t) => t.status !== "done" && t.due && t.due > today && t.due <= weekAhead).sort((a, b) => a.due.localeCompare(b.due)), [dashTasks, today, weekAhead]);
  const dashProjStats = useMemo(() => { const m = new Map<string, { total: number; open: number }>(); dashTasks.forEach((t) => { const s = m.get(t.project_id) ?? { total: 0, open: 0 }; s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s); }); return m; }, [dashTasks]);
  const commentsFor = (type: string, id: string) => comments.filter((c) => c.target_type === type && c.target_id === id).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const myMessages = useMemo(() => comments.filter((c) => (c.mentions || []).includes(viewer)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), [comments, viewer]);
  const [readSet, setReadSet] = useState<Set<string>>(() => new Set(data.reads.map((r) => r.person_id + "|" + r.comment_id)));
  const viewerId = idByName.get(viewer) || "";
  const unread = useMemo(() => myMessages.filter((c) => !readSet.has(viewerId + "|" + c.id)), [myMessages, readSet, viewerId]);
  function markAllRead() {
    if (unread.length === 0 || !viewerId) return;
    const ids = unread.map((c) => c.id);
    setReadSet((s2) => { const n = new Set(s2); ids.forEach((id) => n.add(viewerId + "|" + id)); return n; });
    if (persists) start(() => { markRead(viewerId, ids); });
  }

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      if (view === "project" && selProj && t.project_id !== selProj) return false;
      if (view === "person" && selPerson && !t.assignees.includes(selPerson)) return false;
      if (assignee && !t.assignees.includes(assignee)) return false;
      if (sf === "open" && t.status === "done") return false;
      if (sf === "done" && t.status !== "done") return false;
      if (dueFilter !== "any") {
        if (!t.due) return false;
        if (dueFilter === "overdue" && !(t.due < today)) return false;
        if (dueFilter === "week" && t.due > weekAhead) return false;
        if (dueFilter === "month" && t.due > monthAhead) return false;
      }
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [tasks, view, selProj, selPerson, assignee, sf, q, dueFilter, today, weekAhead, monthAhead]);

  const boardRows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      if (view === "project" && selProj && t.project_id !== selProj) return false;
      if (view === "person" && selPerson && !t.assignees.includes(selPerson)) return false;
      if (assignee && !t.assignees.includes(assignee)) return false;
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [tasks, view, selProj, selPerson, assignee, q]);

  const STATUS_ORDER: Record<string, number> = { todo: 0, in_progress: 1, waiting: 2, blocked: 3, done: 4 };
  const sortedRows = useMemo(() => {
    if (sortBy === "none") return rows;
    const r = [...rows];
    if (sortBy === "project") r.sort((a, b) => projName(a.project_id).localeCompare(projName(b.project_id)));
    else if (sortBy === "priority") r.sort((a, b) => (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2));
    else r.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    return r;
  }, [rows, sortBy, projOverride]);

  const personGroups = useMemo(() => {
    const m = new Map<string, Task[]>();
    if (view === "person") rows.forEach((t) => { const a = m.get(t.project_id) ?? []; a.push(t); m.set(t.project_id, a); });
    return [...m.entries()].sort((a, b) => projName(a[0]).localeCompare(projName(b[0])));
  }, [rows, view, projOverride]);

  function patch(id: string, fn: (t: Task) => Task) { lastEditRef.current = Date.now(); setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t))); }
  function changeStatus(t: Task, status: string) {
    patch(t.id, (x) => ({ ...x, status }));
    if (persists) start(() => { setStatus(t.id, status); });
    // Completing a repeating task spawns its next instance server-side — reload to show it.
    if (status === "done" && ["daily", "weekly", "monthly"].includes(t.repeat)) setTimeout(() => window.location.reload(), 700);
  }
  function toggleDone(t: Task) { changeStatus(t, t.status === "done" ? "todo" : "done"); }
  function addA(t: Task, n: string) { if (!n || t.assignees.includes(n)) return; const pid = idByName.get(n); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: [...x.assignees, n].sort() })); if (persists) start(() => { toggleAssignee(t.id, pid, true); }); }
  function rmA(t: Task, n: string) { const pid = idByName.get(n); if (!pid) return; patch(t.id, (x) => ({ ...x, assignees: x.assignees.filter((a) => a !== n) })); if (persists) start(() => { toggleAssignee(t.id, pid, false); }); }
  function move(t: Task, pid: string) { patch(t.id, (x) => ({ ...x, project_id: pid })); if (persists) start(() => { moveTask(t.id, pid); }); }
  function changeDue(t: Task, due: string) { patch(t.id, (x) => ({ ...x, due })); if (persists) start(() => { setDue(t.id, due); }); }
  function changeDesc(t: Task, d: string) { patch(t.id, (x) => ({ ...x, description: d })); if (persists) start(() => { setDescription(t.id, d); }); }
  function changePri(t: Task, p: string) { patch(t.id, (x) => ({ ...x, priority: p })); if (persists) start(() => { setPriority(t.id, p); }); }
  function changeRepeat(t: Task, r: string) { patch(t.id, (x) => ({ ...x, repeat: r })); if (persists) start(() => { setRepeat(t.id, r); }); }
  function clAdd(taskId: string, text: string) {
    const t = text.trim(); if (!t) return;
    const id = "tmpcl" + Math.random().toString(36).slice(2);
    setChecklists((c) => [...c, { id, task_id: taskId, text: t, done: false, pos: c.length }]);
    if (persists) start(() => { addChecklistItem(taskId, t); });
  }
  function clToggle(item: ChecklistItem) {
    setChecklists((c) => c.map((x) => x.id === item.id ? { ...x, done: !x.done } : x));
    if (persists) start(() => { toggleChecklistItem(item.id, !item.done); });
  }
  function clDelete(item: ChecklistItem) {
    setChecklists((c) => c.filter((x) => x.id !== item.id));
    if (persists) start(() => { deleteChecklistItem(item.id); });
  }
  function depAdd(t: Task, blocksOn: string) {
    if (!blocksOn || blocksOn === t.id) return;
    setDeps((d) => [...d, { task_id: t.id, blocks_on: blocksOn }]);
    const blocker = tasks.find((x) => x.id === blocksOn);
    if (blocker && blocker.status !== "done") patch(t.id, (x) => ({ ...x, status: "blocked" }));
    if (persists) start(() => { addDep(t.id, blocksOn); });
  }
  function depRemove(t: Task, blocksOn: string) {
    setDeps((d) => d.filter((x) => !(x.task_id === t.id && x.blocks_on === blocksOn)));
    if (persists) start(() => { removeDep(t.id, blocksOn); });
  }
  function post(type: "task" | "project", id: string, body: string) { const text = body.trim(); if (!text) return; lastEditRef.current = Date.now(); const c: Comment = { id: "tmp" + Math.random().toString(36).slice(2), target_type: type, target_id: id, author: viewer, body: text, created_at: new Date().toISOString().slice(0, 19), mentions: parseMentions(text) }; setComments((cs) => [...cs, c]); if (persists) start(() => { addComment(type, id, viewer, text); }); }
  function renameProj(id: string, name: string) { const n = name.trim(); if (!n) return; setProjOverride((o) => ({ ...o, [id]: n })); if (persists) start(() => { renameProject(id, n); }); }
  function retitle(t: Task, title: string) { const n = title.trim(); if (!n) return; patch(t.id, (x) => ({ ...x, title: n })); if (persists) start(() => { updateTaskTitle(t.id, n); }); }
  function createTaskRaw(title: string, proj: string, whoName: string) {
    lastEditRef.current = Date.now();
    const id = "tmp" + Math.random().toString(36).slice(2);
    setTasks((ts) => [{ id, project_id: proj, title, status: "todo", priority: "normal", due: "", source_type: "manual", source_title: proj === ONEOFF_ID ? "One-off" : "", source_date: "", source_url: "", description: "", repeat: "", updated_at: new Date().toISOString().slice(0, 10), assignees: whoName ? [whoName] : [] }, ...ts]);
    if (persists) start(() => { addTask(title, proj, whoName ? [idByName.get(whoName) || ""] : []); });
  }
  function submitForm() { const t = ntTitle.trim(); if (!t) return; createTaskRaw(t, selProj || ONEOFF_ID, ntWho); setNtTitle(""); setNtWho(""); setAdding(false); }

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
          <button className={`navlink ${view === "myday" ? "on" : ""}`} onClick={() => goView("myday")}>My Day</button>
          <button className={`navlink ${view === "tasks" ? "on" : ""}`} onClick={() => goView("tasks")}>All tasks</button>
          <button className={`navlink ${view === "workload" ? "on" : ""}`} onClick={() => goView("workload")}>Workload</button>
          <button className={`navlink ${view === "triage" ? "on" : ""}`} onClick={() => goView("triage")}>Triage {triage.length ? <span className="ct unread-ct">{triage.length}</span> : null}</button>
          <button className={`navlink ${view === "messages" ? "on" : ""}`} onClick={() => goView("messages")}>Messages {unread.length ? <span className="ct unread-ct">{unread.length}</span> : null}</button>
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
              <span className="nm">{p.name}{p.name === viewer ? " (me)" : ""}</span>
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
          <div className="gcal"><span className="dot" style={{ background: "var(--sage)" }} /> {viewer}</div>
          <div className="gcal-sub"><button className="clear" style={{ fontSize: 11, padding: 0 }} onClick={() => setShowPicker(true)}>switch user</button></div>
        </div>
      </aside>

      <div className="main-area">
        <div className="topbar">
          <input className="topsearch" placeholder="Search everything…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) goView("tasks"); }} />
          <nav className="tabs">
            {(["dashboard", "calendar", "transcripts", "decisions", "vendors"] as View[]).map((v) => (
              <button key={v} className={`tab ${view === v ? "on" : ""}`} onClick={() => goView(v)}>{TABLABEL[v]}</button>
            ))}
          </nav>
          <span className="spacer" />
          {updatesReady && <button className="updates-pill" onClick={() => window.location.reload()}>↻ New updates — refresh</button>}
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
            <AiChat />
            {staleTasks.length > 0 && (
              <div className="stale-panel">
                <div className="stale-h">≡ HASN&apos;T MOVED</div>
                {staleTasks.map(({ t, days }) => (
                  <div key={t.id} className="stale-row" onClick={() => setOpenTaskId(t.id)}>
                    <span className="stale-title">{t.title}</span>
                    <span className="stale-meta">{projName(t.project_id)} · {days}d</span>
                  </div>
                ))}
              </div>
            )}
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
              {triage.length > 0 && (
                <div className="rail-card triage-rail" onClick={() => goView("triage")}>
                  <div className="rail-h">📥 FROM YOUR MEETINGS</div>
                  <div className="rail-jump">{triage.length} action {triage.length === 1 ? "item" : "items"} to assign →</div>
                </div>
              )}
              <div className="rail-card">
                <div className="rail-h">DUE &amp; OVERDUE</div>
                {dueToday.length === 0 ? <div className="empty-rail">✓ Nothing due</div> :
                  dueToday.slice(0, 8).map((t) => (
                    <div key={t.id} className="rail-row" onClick={() => setOpenTaskId(t.id)}>
                      <span className="rail-row-t">{t.title}</span>
                      <span className={`rail-row-d ${t.due < today ? "overdue" : ""}`}>{t.due < today ? "overdue" : "today"}</span>
                    </div>
                  ))}
                {dueToday.length > 8 && <div className="cal-more" style={{ marginTop: 6 }}>+{dueToday.length - 8} more</div>}
              </div>
              <div className="rail-card">
                <div className="rail-h">UPCOMING · 7 DAYS</div>
                {upcoming.length === 0 ? <div className="empty-rail">Nothing upcoming</div> :
                  upcoming.slice(0, 8).map((t) => (
                    <div key={t.id} className="rail-row" onClick={() => setOpenTaskId(t.id)}>
                      <span className="rail-row-t">{t.title}</span>
                      <span className="rail-row-d">{t.due.slice(5)}</span>
                    </div>
                  ))}
                {upcoming.length > 8 && <div className="cal-more" style={{ marginTop: 6 }}>+{upcoming.length - 8} more</div>}
              </div>
            </aside>
          </div>
        )}

        {view === "messages" && (
          <>
            <div className="page-h" style={{ display: "flex", gap: 12, alignItems: "baseline" }}>Messages {unread.length > 0 && <button className="clear" onClick={markAllRead}>mark all read ({unread.length})</button>}</div>
            <div className="msglist">
              {myMessages.length === 0 ? <div className="empty">No messages mention you yet.</div> :
                myMessages.map((c) => (
                  <div key={c.id} className={`msg ${!readSet.has(viewerId + "|" + c.id) ? "msg-unread" : ""}`}>
                    <div className="msg-h"><b>{c.author}</b> in <span className="src">{projName(c.target_id) || c.target_id}</span> · {c.created_at?.replace("T", " ")}</div>
                    <div className="msg-b"><Body text={c.body} /></div>
                  </div>
                ))}
            </div>
          </>
        )}

        {view === "myday" && (() => {
          const mine = tasks.filter((t) => t.assignees.includes(viewer) && t.status !== "done");
          const secs: [string, Task[]][] = [
            ["Overdue", mine.filter((t) => t.due && t.due < today)],
            ["Due today", mine.filter((t) => t.due === today)],
            ["Due this week", mine.filter((t) => t.due && t.due > today && t.due <= weekAhead)],
            ["Urgent (no date)", mine.filter((t) => t.priority === "urgent" && (!t.due || t.due > weekAhead))],
          ];
          const Row = ({ t }: { t: Task }) => (
            <div className="stale-row" onClick={() => setOpenTaskId(t.id)}>
              <span className="stale-title">{t.title}</span>
              <span className="stale-meta">{projName(t.project_id)}{t.due ? ` · ${t.due}` : ""}</span>
            </div>
          );
          return (
            <>
              <div className="page-h">My Day — {viewer.split(" ")[0]}</div>
              {secs.every(([, l]) => l.length === 0) && <div className="empty">Nothing urgent, due, or overdue. 🎉</div>}
              {secs.map(([h, list]) => list.length > 0 && (
                <div key={h} className="myday-sec">
                  <div className="desc-l">{h} ({list.length})</div>
                  {list.map((t) => <Row key={t.id} t={t} />)}
                </div>
              ))}
            </>
          );
        })()}

        {view === "calendar" && (() => {
          const { y, m } = calBase;
          const first = new Date(Date.UTC(y, m, 1));
          const startDow = first.getUTCDay();
          const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
          const cells: (string | null)[] = [
            ...Array.from({ length: startDow }, () => null),
            ...Array.from({ length: daysIn }, (_, i) => `${y}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`),
          ];
          const byDay = new Map<string, Task[]>();
          tasks.forEach((t) => { if (t.due && t.status !== "done") { const a = byDay.get(t.due) ?? []; a.push(t); byDay.set(t.due, a); } });
          const monthName = first.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
          return (
            <>
              <div className="page-h" style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
                <button className="clear" onClick={() => setCalBase(({ y: yy, m: mm }) => mm === 0 ? { y: yy - 1, m: 11 } : { y: yy, m: mm - 1 })}>←</button>
                {monthName} {y}
                <button className="clear" onClick={() => setCalBase(({ y: yy, m: mm }) => mm === 11 ? { y: yy + 1, m: 0 } : { y: yy, m: mm + 1 })}>→</button>
              </div>
              <div className="cal-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
                {cells.map((d, i) => (
                  <div key={i} className={`cal-cell ${d === today ? "cal-today" : ""}`}>
                    {d && <><div className="cal-n">{Number(d.slice(8))}</div>
                      {(byDay.get(d) ?? []).slice(0, 4).map((t) => (
                        <div key={t.id} className={`cal-task ${d < today ? "overdue-t" : ""}`} onClick={() => setOpenTaskId(t.id)} title={t.title}>{t.title}</div>
                      ))}
                      {(byDay.get(d) ?? []).length > 4 && <div className="cal-more">+{(byDay.get(d) ?? []).length - 4}</div>}
                    </>}
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {view === "triage" && (
          <>
            <div className="page-h">Triage — action items from meetings</div>
            {triage.length === 0 ? (
              <div className="empty">No pending items. New Otter meetings are scanned daily — their action items land here for review. (Needs GITHUB_TOKEN in Vercel; see HANDOFF.md.)</div>
            ) : (
              <div className="msglist">
                {triage.map((it) => (
                  <TriageCard key={it.id} it={it} projects={data.projects.map((pp) => ({ id: pp.id, name: projName(pp.id) }))}
                    onAccept={(pid, person, due) => {
                      setTriage((ts) => ts.filter((x) => x.id !== it.id));
                      if (persists) start(() => { acceptTriage(it.id, pid, idByName.get(person) || "", due); });
                    }}
                    onDismiss={() => { setTriage((ts) => ts.filter((x) => x.id !== it.id)); if (persists) start(() => { dismissTriage(it.id); }); }} />
                ))}
              </div>
            )}
          </>
        )}

        {view === "workload" && (() => {
          const max = Math.max(1, ...TEAM.map((n) => personOpen.get(n) ?? 0));
          return (
            <>
              <div className="page-h">Workload</div>
              <div className="workload">
                {TEAM.map((n) => {
                  const mine = tasks.filter((t) => t.assignees.includes(n) && t.status !== "done");
                  const seg = (st: string) => mine.filter((t) => t.status === st).length;
                  const urgent = mine.filter((t) => t.priority === "urgent").length;
                  return (
                    <div key={n} className="wl-row" onClick={() => goPerson(n)}>
                      <span className="wl-name">{n}{urgent > 0 && <span className="wl-urgent">{urgent} urgent</span>}</span>
                      <div className="wl-bar">
                        {STATUSES.filter((st) => st.id !== "done").map((st) => {
                          const w = (seg(st.id) / max) * 100;
                          return w > 0 ? <span key={st.id} style={{ width: `${w}%`, background: st.color }} title={`${st.label}: ${seg(st.id)}`} /> : null;
                        })}
                      </div>
                      <span className="wl-n">{mine.length}</span>
                    </div>
                  );
                })}
                <div className="wl-legend">
                  {STATUSES.filter((st) => st.id !== "done").map((st) => (
                    <span key={st.id} className="chip"><span className="dot" style={{ background: st.color }} /> {st.label}</span>
                  ))}
                </div>
              </div>
            </>
          );
        })()}

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
            {view === "person" && (
              <div className="seg" style={{ marginBottom: 14 }}>
                <button className={personMode === "project" ? "on" : ""} onClick={() => setPersonMode("project")}>By project</button>
                <button className={personMode === "task" ? "on" : ""} onClick={() => setPersonMode("task")}>By task</button>
              </div>
            )}
            {view === "tasks" && <div className="page-h">All tasks</div>}

            <div className="controls">
              <div className="statustabs">
                <button className={sf === "open" ? "on" : ""} onClick={() => setSf("open")}>Open</button>
                <button className={sf === "all" ? "on" : ""} onClick={() => setSf("all")}>All</button>
                <button className={sf === "done" ? "on" : ""} onClick={() => setSf("done")}>Done</button>
              </div>
              <div className="statustabs">
                <button className={layout === "cards" ? "on" : ""} onClick={() => setLayout("cards")}>Cards</button>
                <button className={layout === "board" ? "on" : ""} onClick={() => setLayout("board")}>Board</button>
              </div>
              {view === "tasks" && (
                <select className="streamsel" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Anyone</option>
                  {TEAM.map((n) => <option key={n} value={n}>{n} ({personOpen.get(n) ?? 0})</option>)}
                </select>
              )}
              {(view === "tasks" || (view === "person" && personMode === "task")) && (
                <select className="streamsel" value={sortBy} onChange={(e) => setSortBy(e.target.value as "none" | "project" | "status" | "priority")}>
                  <option value="none">Sort: default</option>
                  <option value="project">Sort: project</option>
                  <option value="status">Sort: status</option>
                  <option value="priority">Sort: priority</option>
                </select>
              )}
              <select className="streamsel" value={dueFilter} onChange={(e) => setDueFilter(e.target.value as "any" | "overdue" | "week" | "month")} title="Due">
                <option value="any">Due: any</option>
                <option value="overdue">Overdue</option>
                <option value="week">Due this week</option>
                <option value="month">Due this month</option>
              </select>
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

            {view === "person" && personMode === "project" ? (
              personGroups.length === 0 ? <div className="empty">No tasks.</div> : (
                <div className="columns">
                  {personGroups.map(([pid, items]) => (
                    <div key={pid} className="col">
                      <div className="col-h" onClick={() => goProject(pid)}>
                        <span className="dot" style={{ background: projColor.get(pid) }} />
                        <span className="nm">{projName(pid)}</span>
                        <span className="all">Open</span>
                      </div>
                      {items.map((t) => (
                        <div key={t.id} className={`row-t ${t.status === "done" ? "done" : ""}`}>
                          <input type="checkbox" checked={t.status === "done"} onChange={() => toggleDone(t)} />
                          <span onClick={() => setOpenTaskId(t.id)} style={{ cursor: "pointer", flex: 1 }}>{t.title}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )
            ) : layout === "board" ? (
              <div className="board">
                {STATUSES.map((st) => {
                  const items = boardRows.filter((t) => t.status === st.id);
                  return (
                    <div key={st.id} className="bcol"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { const id = e.dataTransfer.getData("text/task"); const t = tasks.find((x) => x.id === id); if (t && t.status !== st.id) changeStatus(t, st.id); }}>
                      <div className="bcol-h" style={{ color: st.color }}>{st.label} <span className="ct">{items.length}</span></div>
                      {items.slice(0, 60).map((t) => (
                        <div key={t.id} className="bcard" draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}
                          onClick={() => setOpenTaskId(t.id)}>
                          <div className="bcard-t">{t.priority === "urgent" && <span className="pri pri-urgent" style={{ padding: "0 6px", marginRight: 4 }}>!</span>}{t.title}</div>
                          <div className="bcard-m">{view !== "project" ? projName(t.project_id) : ""}{t.assignees.length ? ` · ${t.assignees.map((a) => a.split(" ")[0]).join(", ")}` : ""}{t.due ? ` · ${t.due}` : ""}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (<>
            {sortedRows.length === 0 ? <div className="empty">No tasks match.</div> : (
              <div className="tasklist">
                {sortedRows.slice(0, 300).map((t) => (
                  <div key={t.id} className={`tcard ${t.status === "done" ? "done" : ""} ${dueClass(t.due)} ${t.priority === "urgent" ? "pri-urgent" : ""}`}>
                    <div className="tcard-top">
                      <span style={{ display: "flex", gap: 6 }}>
                      <select className={`stk stk-${t.status}`} value={t.status} onChange={(e) => changeStatus(t, e.target.value)}>
                        {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                      <select className={`pri pri-${t.priority}`} value={PRI_ORDER[t.priority] !== undefined ? t.priority : "normal"} onChange={(e) => changePri(t, e.target.value)} title="Priority">
                        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      </span>
                      {view === "tasks" ? (
                        <select className="proj-pick" value={t.project_id} onChange={(e) => move(t, e.target.value)} title="Project">
                          {data.projects.map((p) => <option key={p.id} value={p.id}>{projName(p.id)}</option>)}
                        </select>
                      ) : view !== "project" ? (
                        <span className="proj-chip" onClick={() => goProject(t.project_id)} title="Open project">{projName(t.project_id)}</span>
                      ) : null}
                    </div>
                    <div className="tcard-title">{t.project_id === ONEOFF_ID && <span className="oneoff-tag">one-off</span>}{t.repeat && <span className="repeat-tag" title={`repeats ${t.repeat}`}>↻ {t.repeat}</span>}{t.title}</div>
                    <div className="chips">
                      {t.assignees.map((a) => <span key={a} className="who" onClick={() => rmA(t, a)} title="remove">{a} ×</span>)}
                      <select className="streamsel" value="" onChange={(e) => { addA(t, e.target.value); e.currentTarget.value = ""; }}>
                        <option value="">+ assign…</option>
                        {TEAM.filter((n) => !t.assignees.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="tcard-foot">
                      {(() => { const cl = checklists.filter((c) => c.task_id === t.id); return cl.length ? <span className="cl-prog">✓ {cl.filter((c) => c.done).length}/{cl.length}</span> : null; })()}
                      <input type="date" className={`dueinput ${dueClass(t.due)}`} value={t.due || ""} onChange={(e) => changeDue(t, e.target.value)} title="Due date" />
                      <button className="linkbtn" onClick={() => setOpenTaskId(t.id)}>💬 {commentsFor("task", t.id).length || ""}</button>
                      {t.source_url && <a className="src" href={t.source_url} target="_blank" rel="noreferrer">source</a>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {sortedRows.length > 300 && <p className="note">Showing first 300 of {sortedRows.length} — filter or search.</p>}
            </>)}

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
              <span style={{ display: "flex", gap: 6 }}>
                <select className={`stk stk-${openTask.status}`} value={openTask.status} onChange={(e) => changeStatus(openTask, e.target.value)}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select className={`pri pri-${openTask.priority}`} value={PRI_ORDER[openTask.priority] !== undefined ? openTask.priority : "normal"} onChange={(e) => changePri(openTask, e.target.value)} title="Priority">
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </span>
              <button className="clear" onClick={() => setOpenTaskId(null)}>✕</button>
            </div>
            <Editable className="modal-title" value={openTask.title} onSave={(n) => retitle(openTask, n)} />
            <div className="src" style={{ marginBottom: 10 }}>
              Project: {projName(openTask.project_id)} · Due: <input type="date" className={`dueinput ${dueClass(openTask.due)}`} value={openTask.due || ""} onChange={(e) => changeDue(openTask, e.target.value)} />
              {" "}· Repeats: <select className="streamsel" style={{ padding: "2px 6px", fontSize: 12 }} value={openTask.repeat || ""} onChange={(e) => changeRepeat(openTask, e.target.value)}>
                <option value="">never</option><option value="daily">daily</option><option value="weekly">weekly</option><option value="monthly">monthly</option>
              </select>
            </div>
            <div className="chips" style={{ marginBottom: 10 }}>
              {openTask.assignees.map((a) => <span key={a} className="who" onClick={() => rmA(openTask, a)}>{a} ×</span>)}
              <select className="streamsel" value="" onChange={(e) => { addA(openTask, e.target.value); e.currentTarget.value = ""; }}>
                <option value="">+ assign…</option>
                {TEAM.filter((n) => !openTask.assignees.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <DescriptionBox key={openTask.id} value={openTask.description || ""} onSave={(d) => changeDesc(openTask, d)} />
            <div className="descbox">
              <div className="desc-l">Checklist</div>
              {checklists.filter((c) => c.task_id === openTask.id).map((c) => (
                <div key={c.id} className="cl-row">
                  <input type="checkbox" checked={c.done} onChange={() => clToggle(c)} />
                  <span className={c.done ? "cl-done" : ""}>{c.text}</span>
                  <button className="clear" onClick={() => clDelete(c)}>×</button>
                </div>
              ))}
              <AddInline placeholder="Add checklist step…" onAdd={(v) => clAdd(openTask.id, v)} />
            </div>
            <div className="descbox">
              <div className="desc-l">Blocked by</div>
              {deps.filter((d) => d.task_id === openTask.id).map((d) => {
                const b = tasks.find((x) => x.id === d.blocks_on);
                return (
                  <div key={d.blocks_on} className="cl-row">
                    <span>🔒 {b ? b.title : d.blocks_on}{b && b.status === "done" ? " ✓" : ""}</span>
                    <button className="clear" onClick={() => depRemove(openTask, d.blocks_on)}>×</button>
                  </div>
                );
              })}
              <select className="streamsel" value="" onChange={(e) => { depAdd(openTask, e.target.value); e.currentTarget.value = ""; }}>
                <option value="">+ add blocking task…</option>
                {tasks.filter((x) => x.id !== openTask.id && x.status !== "done" && (x.project_id === openTask.project_id || tasks.length < 80)).slice(0, 100).map((x) => (
                  <option key={x.id} value={x.id}>{x.title.slice(0, 70)}</option>
                ))}
              </select>
            </div>
            <Thread items={commentsFor("task", openTask.id)} onPost={(b) => post("task", openTask.id, b)} />
          </div>
        </div>
      )}
      <button className="logdecision" onClick={() => goView("decisions")}>⚡ Log Decision</button>

      {showPicker && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 380, textAlign: "center" }}>
            <h2 className="modal-title" style={{ width: "100%" }}>Who are you?</h2>
            <p className="src" style={{ marginBottom: 14 }}>This sets your Messages, mentions, and &quot;me&quot; views on this device.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TEAM.map((n) => (
                <button key={n} className={n === viewer ? "btn-primary" : "tab"} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px" }} onClick={() => pickViewer(n)}>{n}</button>
              ))}
            </div>
          </div>
        </div>
      )}
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

function TriageCard({ it, projects, onAccept, onDismiss }: {
  it: TriageItem;
  projects: { id: string; name: string }[];
  onAccept: (projectId: string, person: string, due: string) => void;
  onDismiss: () => void;
}) {
  const [pid, setPid] = useState(it.project_guess || "oneoff");
  const [person, setPerson] = useState(it.assignee_guess || "");
  const [due, setDue] = useState("");
  return (
    <div className="msg">
      <div className="msg-b" style={{ fontWeight: 600 }}>{it.title}</div>
      <div className="msg-h" style={{ margin: "4px 0 8px" }}>
        from <a href={it.source_url} target="_blank" rel="noreferrer">{it.source_title}</a> · {it.source_date}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select className="streamsel" value={pid} onChange={(e) => setPid(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="streamsel" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Unassigned</option>
          {TEAM.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="date" className="dueinput" value={due} onChange={(e) => setDue(e.target.value)} />
        <button className="btn-primary" style={{ padding: "6px 14px" }} onClick={() => onAccept(pid, person, due)}>✓ Accept</button>
        <button className="clear" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="cl-add">
      <input placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v); setV(""); } }} />
      <button className="post" onClick={() => { if (v.trim()) { onAdd(v); setV(""); } }} disabled={!v.trim()}>Add</button>
    </div>
  );
}

function DescriptionBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="descbox">
      <div className="desc-l">Description / context</div>
      <textarea className="desc" placeholder="Add context so the team understands this task…" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onSave(v)} />
    </div>
  );
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
