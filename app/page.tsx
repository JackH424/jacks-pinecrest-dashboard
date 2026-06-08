import { getTasks, PRIMARY_USER } from "@/lib/tasks";
import TaskBoard from "./TaskBoard";

export default function Home() {
  const tasks = getTasks();
  const mine = tasks.filter((t) => t.assignee === PRIMARY_USER).length;
  const open = tasks.filter((t) => t.status !== "done").length;
  const assignees = new Set(
    tasks.map((t) => t.assignee).filter((a) => a && a !== "Unassigned")
  ).size;

  return (
    <div className="wrap">
      <header className="top">
        <h1>Pinecrest Mission Control</h1>
        <span className="sub">tasks &amp; follow-ups from meetings</span>
      </header>

      <div className="stats">
        <div className="stat"><div className="n">{tasks.length}</div><div className="l">Total tasks</div></div>
        <div className="stat"><div className="n">{open}</div><div className="l">Open</div></div>
        <div className="stat"><div className="n">{mine}</div><div className="l">Assigned to me</div></div>
        <div className="stat"><div className="n">{assignees}</div><div className="l">People</div></div>
      </div>

      <TaskBoard tasks={tasks} primaryUser={PRIMARY_USER} />

      <p className="note">
        A1 preview — tasks are seeded from {tasks.length} meeting action items.
        Status changes here are local only until the database is added (Phase A2).
      </p>
    </div>
  );
}
