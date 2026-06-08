import { getWorkspace, PRIMARY_USER } from "@/lib/data";
import { dbConnected } from "@/lib/db";
import Workspace from "./Workspace";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = await getWorkspace();
  const openTasks = data.tasks.filter((t) => t.status !== "done").length;

  return (
    <div className="wrap">
      <header className="top">
        <h1>Pinecrest Mission Control</h1>
        <span className="sub">projects, tasks &amp; people</span>
      </header>

      <div className="stats">
        <div className="stat"><div className="n">{data.projects.length}</div><div className="l">Projects</div></div>
        <div className="stat"><div className="n">{data.tasks.length}</div><div className="l">Tasks</div></div>
        <div className="stat"><div className="n">{openTasks}</div><div className="l">Open</div></div>
        <div className="stat"><div className="n">{data.people.length}</div><div className="l">People</div></div>
      </div>

      <Workspace data={data} primaryUser={PRIMARY_USER} persists={dbConnected()} />

      <p className="note">
        {dbConnected()
          ? "Connected — projects from Monday, tasks from meetings, assignees editable."
          : "Preview mode — connect the database for editing to persist."}
      </p>
    </div>
  );
}
