"use client";

import { useMemo, useState, useTransition } from "react";
import type { Workspace as WS, Task } from "@/lib/data";
import { setStatus, toggleAssignee, moveTask } from "./actions";

type View = "projects" | "tasks" | "people";
type SF = "open" | "all" | "done";

export default function Workspace({
  data, primaryUser, persists,
}: { data: WS; primaryUser: string; persists: boolean }) {
  const [, start] = useTransition();
  const [tasks, setTasks] = useState<Task[]>(data.tasks);
  const [view, setView] = useState<View>("projects");
  const [selProj, setSelProj] = useState<string | null>(null);
  const [selPerson, setSelPerson] = useState<string | null>(null); // person name
  const [q, setQ] = useState("");
  const [sf, setSf] = useState<SF>("open");

  const idByName = useMemo(() => new Map(data.people.map((p) => [p.name, p.id])), [data.people]);
  const projName = useMemo(() => new Map(data.projects.map((p) => [p.id, p.name])), [data.projects]);

  const projStats = useMemo(() => {
    const m = new Map<string, { total: number; open: number }>();
    tasks.forEach((t) => {
      const s = m.get(t.project_id) ?? { total: 0, open: 0 };
      s.total++; if (t.status !== "done") s.open++; m.set(t.project_id, s);
    });
    return m;
  }, [tasks]);

  const personOpen = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => { if (t.status !== "done") t.assignees.forEach((a) => m.set(a, (m.get(a) ?? 0) + 1)); });
    return m;
  }, [tasks]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.filter((t) => {
      if (selProj && t.project_id !== selProj) return false;
      if (selPerson && !t.assignees.includes(selPerson)) return false;
      if (sf === "open" && t.status === "done") return false;
      if (sf === "done" && t.status !== "done") return false;
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [tasks, selProj, selPerson, sf, q]);

  function patch(id: string, fn: (t: Task) => Task) { setTasks((ts) => ts.map((t) => (t.id === id ? fn(t) : t))); }
  function cycle(t: Task) {
    const next = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
    patch(t.id, (x) => ({ ...x, status: next }));
    if (persists) start(() => { setStatus(t.id, next); });
  }
  function addAssignee(t: Task, name: string) {
    if (!name || t.assignees.includes(name)) return;
    const pid = idByName.get(name); if (!pid) return;
    patch(t.id, (x) => ({ ...x, assignees: [...x.assignees, name].sort() }));
    if (persists) start(() => { toggleAssignee(t.id, pid, true); });
  }
  function removeAssignee(t: Task, name: string) {
    const pid = idByName.get(name); if (!pid) return;
    patch(t.id, (x) => ({ ...x, assignees: x.assignees.filter((a) => a !== name) }));
    if (persists) start(() => { toggleAssignee(t.id, pid, false); });
  }
  function move(t: Task, projectId: string) {
    patch(t.id, (x) => ({ ...x, project_id: projectId }));
    if (persists) start(() => { moveTask(t.id, projectId); });
  }

  function switchView(v: View) { setView(v); setSelProj(null); setSelPerson(null); }

  const showingCards = (view === "projects" && !selProj) || (view === "people" && !selPerson);
  const heading = selProj ? projName.get(selProj) : selPerson;

  return (
    <>
      <div className="seg">
        <button className={view === "projects" ? "on" : ""} onClick={() => switchView("projects")}>Projects</button>
        <button className={view === "tasks" ? "on" : ""} onClick={() => switchView("tasks")}>Tasks</button>
        <button className={view === "people" ? "on" : ""} onClick={() => switchView("people")}>People</button>
      </div>

      {/* Cards: shown only when browsing projects/people with nothing opened */}
      {showingCards && view === "projects" && (
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
      {showingCards && view === "people" && (
        <div className="cards">
          {data.people.filter((p) => (personOpen.get(p.name) ?? 0) > 0 || p.name === primaryUser)
            .sort((a, b) => (personOpen.get(b.name) ?? 0) - (personOpen.get(a.name) ?? 0))
            .map((p) => (
              <div key={p.id} className="card" onClick={() => setSelPerson(p.name)}>
                <div className="name">{p.name}{p.name === primaryUser ? " (me)" : ""}</div>
                <div className="meta"><span className="big">{personOpen.get(p.name) ?? 0}</span> open</div>
              </div>
            ))}
        </div>
      )}

      {/* Focused list: a single project, a single person, or the flat Tasks view */}
      {!showingCards && (
        <>
          {heading && (
            <div className="crumb">
              <button className="clear" onClick={() => { setSelProj(null); setSelPerson(null); }}>
                ← Back to {view === "projects" ? "projects" : "people"}
              </button>
              <h2>{heading}</h2>
            </div>
          )}

          <div className="controls">
            <div className="statustabs">
              <button className={sf === "open" ? "on" : ""} onClick={() => setSf("open")}>Open</button>
              <button className={sf === "all" ? "on" : ""} onClick={() => setSf("all")}>All</button>
              <button className={sf === "done" ? "on" : ""} onClick={() => setSf("done")}>Done</button>
            </div>
            <span className="spacer" />
            <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>

          {rows.length === 0 ? (
            <div className="empty">No tasks match.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width: 78 }}>Status</th>
                  <th>Task</th>
                  <th style={{ width: 230 }}>Assignees</th>
                  <th style={{ width: 170 }}>Project</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((t) => (
                  <tr key={t.id} className={t.status === "done" ? "done" : ""}>
                    <td><span className={`badge ${t.status}`} onClick={() => cycle(t)}>{t.status}</span></td>
                    <td className="title">{t.title}
                      {t.source_url && <> · <a className="src" href={t.source_url} target="_blank" rel="noreferrer">source</a></>}
                    </td>
                    <td>
                      <div className="chips">
                        {t.assignees.map((a) => (
                          <span key={a} className="who" onClick={() => removeAssignee(t, a)} title="click to remove">{a} ×</span>
                        ))}
                        <select className="streamsel" value="" onChange={(e) => { addAssignee(t, e.target.value); e.currentTarget.value = ""; }}>
                          <option value="">+ assign…</option>
                          {data.people.filter((p) => !t.assignees.includes(p.name)).map((p) => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td>
                      <select className="streamsel" value={t.project_id} onChange={(e) => move(t, e.target.value)}>
                        {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 400 && <p className="note">Showing first 400 of {rows.length} — filter or search to narrow.</p>}
        </>
      )}
    </>
  );
}
