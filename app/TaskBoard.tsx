"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/tasks";
import { setStatus } from "./actions";

type Tab = "all" | "mine" | "followups";

export default function TaskBoard({
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
  const [tab, setTab] = useState<Tab>("mine");
  const [q, setQ] = useState("");
  const [assignee, setAssignee] = useState("");
  // Local-only status overrides until A2 adds the database.
  const [overrides, setOverrides] = useState<Record<string, Task["status"]>>({});

  const assignees = useMemo(
    () =>
      Array.from(new Set(tasks.map((t) => t.assignee)))
        .filter(Boolean)
        .sort(),
    [tasks]
  );

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return tasks
      .map((t) => ({ ...t, status: overrides[t.id] ?? t.status }))
      .filter((t) => {
        if (tab === "mine" && t.assignee !== primaryUser) return false;
        if (tab === "followups" && !/follow[\s-]?up|circle back|check in|reschedul/i.test(t.title))
          return false;
        if (assignee && t.assignee !== assignee) return false;
        if (ql && !(t.title.toLowerCase().includes(ql) || t.source_title.toLowerCase().includes(ql)))
          return false;
        return true;
      });
  }, [tasks, tab, q, assignee, overrides, primaryUser]);

  function cycle(id: string, cur: Task["status"]) {
    const next: Task["status"] =
      cur === "todo" ? "doing" : cur === "doing" ? "done" : "todo";
    setOverrides((o) => ({ ...o, [id]: next })); // optimistic
    if (persists) {
      startTransition(async () => {
        await setStatus(id, next);
        router.refresh();
      });
    }
  }

  return (
    <>
      <div className="controls">
        <div className="tabs">
          <button className={`tab ${tab === "mine" ? "active" : ""}`} onClick={() => setTab("mine")}>My tasks</button>
          <button className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>All</button>
          <button className={`tab ${tab === "followups" ? "active" : ""}`} onClick={() => setTab("followups")}>Follow-ups</button>
        </div>
        <span className="spacer" />
        <input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">All people</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No tasks match.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Status</th>
              <th>Task</th>
              <th style={{ width: 150 }}>Assignee</th>
              <th style={{ width: 200 }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.status === "done" ? "done" : ""}>
                <td>
                  <button className="chk" onClick={() => cycle(t.id, t.status)}>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </button>
                </td>
                <td className="title">{t.title}</td>
                <td className="assignee">{t.assignee}</td>
                <td className="src">
                  <a href={t.source_url} target="_blank" rel="noreferrer">
                    {t.source_title}
                  </a>
                  <br />
                  {t.source_date}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
