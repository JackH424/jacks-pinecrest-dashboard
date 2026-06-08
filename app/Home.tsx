"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/tasks";
import { STREAM_NAMES, streamColor } from "@/lib/streams";
import { setStatus, setStream } from "./actions";

type View = "streams" | "people" | "all";
type StatusFilter = "open" | "all" | "done";

export default function Home({
  tasks,
  primaryUser,
  persists,
}: {
  tasks: Task[];
  primaryUser: string;
  persists: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useState<View>("streams");
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [ov, setOv] = useState<Record<string, Task["status"]>>({});
  const [ovStream, setOvStream] = useState<Record<string, string>>({});

  const eff = (t: Task): Task => ({
    ...t,
    status: ov[t.id] ?? t.status,
    stream: ovStream[t.id] ?? t.stream,
  });

  const people = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      if (eff(t).status === "done") return;
      m.set(t.assignee, (m.get(t.assignee) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks, ov]);

  const streamCounts = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => {
      const e = eff(t);
      if (e.status === "done") return;
      m.set(e.stream, (m.get(e.stream) ?? 0) + 1);
    });
    return m;
  }, [tasks, ov, ovStream]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks.map(eff).filter((t) => {
      if (view === "streams" && selected && t.stream !== selected) return false;
      if (view === "people" && selected && t.assignee !== selected) return false;
      if (statusFilter === "open" && t.status === "done") return false;
      if (statusFilter === "done" && t.status !== "done") return false;
      if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql)))
        return false;
      return true;
    });
  }, [tasks, view, selected, statusFilter, q, ov, ovStream]);

  function switchView(v: View) {
    setView(v);
    setSelected(null);
  }

  function cycle(id: string, cur: Task["status"]) {
    const next: Task["status"] = cur === "todo" ? "doing" : cur === "doing" ? "done" : "todo";
    setOv((o) => ({ ...o, [id]: next }));
    if (persists) startTransition(async () => { await setStatus(id, next); router.refresh(); });
  }
  function changeStream(id: string, s: string) {
    setOvStream((o) => ({ ...o, [id]: s }));
    if (persists) startTransition(async () => { await setStream(id, s); router.refresh(); });
  }

  return (
    <>
      <div className="seg">
        <button className={view === "streams" ? "on" : ""} onClick={() => switchView("streams")}>Streams</button>
        <button className={view === "people" ? "on" : ""} onClick={() => switchView("people")}>People</button>
        <button className={view === "all" ? "on" : ""} onClick={() => switchView("all")}>All tasks</button>
      </div>

      {view === "streams" && (
        <div className="cards">
          {STREAM_NAMES.map((name) => (
            <div
              key={name}
              className={`card ${selected === name ? "sel" : ""}`}
              onClick={() => setSelected(selected === name ? null : name)}
            >
              <div className="row1">
                <span className="dot" style={{ background: streamColor(name) }} />
                <span className="name">{name}</span>
              </div>
              <div className="meta"><span className="big">{streamCounts.get(name) ?? 0}</span> open</div>
            </div>
          ))}
        </div>
      )}

      {view === "people" && (
        <div className="cards">
          {people.map(([name, count]) => (
            <div
              key={name}
              className={`card ${selected === name ? "sel" : ""}`}
              onClick={() => setSelected(selected === name ? null : name)}
            >
              <div className="row1">
                <span className="name">{name}{name === primaryUser ? " (me)" : ""}</span>
              </div>
              <div className="meta"><span className="big">{count}</span> open</div>
            </div>
          ))}
        </div>
      )}

      <div className="controls">
        <div className="statustabs">
          <button className={statusFilter === "open" ? "on" : ""} onClick={() => setStatusFilter("open")}>Open</button>
          <button className={statusFilter === "all" ? "on" : ""} onClick={() => setStatusFilter("all")}>All</button>
          <button className={statusFilter === "done" ? "on" : ""} onClick={() => setStatusFilter("done")}>Done</button>
        </div>
        {selected && <button className="clear" onClick={() => setSelected(null)}>× {selected}</button>}
        <span className="spacer" />
        <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <div className="empty">No tasks match.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Status</th>
              <th>Task</th>
              <th style={{ width: 130 }}>Assignee</th>
              <th style={{ width: 150 }}>Stream</th>
              <th style={{ width: 180 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.status === "done" ? "done" : ""}>
                <td>
                  <span className={`badge ${t.status}`} onClick={() => cycle(t.id, t.status)}>{t.status}</span>
                </td>
                <td className="title">{t.title}</td>
                <td>{t.assignee}</td>
                <td>
                  <span className="chip"><span className="dot" style={{ background: streamColor(t.stream) }} /></span>{" "}
                  <select className="streamsel" value={t.stream} onChange={(e) => changeStream(t.id, e.target.value)}>
                    {STREAM_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="src">
                  <a href={t.source_url} target="_blank" rel="noreferrer">{t.source_title}</a>
                  <br />{t.source_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
