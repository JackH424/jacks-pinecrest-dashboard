import { getSql } from "./db";
import seedProjects from "@/data/seed_projects.json";
import seedPeople from "@/data/seed_people.json";
import seedMembers from "@/data/seed_project_members.json";
import seedTasks from "@/data/seed_tasks.json";
import seedAssignees from "@/data/seed_task_assignees.json";

export const PRIMARY_USER = "Jack Harris";

export type Project = {
  id: string; name: string; status: string; priority: number;
  position: number; members: string[]; total: number; open: number;
};
export type Person = { id: string; name: string; open: number };
export type Task = {
  id: string; project_id: string; title: string; status: string;
  priority: string; due: string; source_type: string; source_title: string;
  source_date: string; source_url: string; assignees: string[];
};
export type Workspace = { projects: Project[]; people: Person[]; tasks: Task[] };

let ready = false;

async function ensureReady(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, status text DEFAULT 'todo', priority int DEFAULT 2, position int DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS people (id text PRIMARY KEY, name text NOT NULL, email text DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS project_members (project_id text, person_id text, PRIMARY KEY (project_id, person_id))`;
  await sql`CREATE TABLE IF NOT EXISTS tasks2 (
    id text PRIMARY KEY, project_id text NOT NULL DEFAULT 'inbox', title text NOT NULL,
    status text DEFAULT 'todo', priority text DEFAULT 'normal', due text DEFAULT '',
    source_type text DEFAULT 'manual', source_title text DEFAULT '', source_date text DEFAULT '', source_url text DEFAULT '',
    updated_at timestamptz DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS task_assignees (task_id text, person_id text, PRIMARY KEY (task_id, person_id))`;

  const n = (await sql`SELECT count(*)::int AS n FROM projects`) as { n: number }[];
  if (n[0]?.n === 0) {
    await sql`INSERT INTO people (id,name) SELECT id,name FROM json_to_recordset(${JSON.stringify(seedPeople)}::json) AS x(id text, name text) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO projects (id,name,status,priority,position) SELECT id,name,status,priority,position FROM json_to_recordset(${JSON.stringify(seedProjects)}::json) AS x(id text, name text, status text, priority int, position int) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO project_members (project_id,person_id) SELECT project_id,person_id FROM json_to_recordset(${JSON.stringify(seedMembers)}::json) AS x(project_id text, person_id text) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO tasks2 (id,project_id,title,status,priority,due,source_type,source_title,source_date,source_url)
      SELECT id,project_id,title,status,priority,due,source_type,source_title,source_date,source_url
      FROM json_to_recordset(${JSON.stringify(seedTasks)}::json) AS x(
        id text, project_id text, title text, status text, priority text, due text,
        source_type text, source_title text, source_date text, source_url text) ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO task_assignees (task_id,person_id) SELECT task_id,person_id FROM json_to_recordset(${JSON.stringify(seedAssignees)}::json) AS x(task_id text, person_id text) ON CONFLICT DO NOTHING`;
  }
  ready = true;
}

function fallback(): Workspace {
  const id2name = new Map((seedPeople as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const aByTask = new Map<string, string[]>();
  (seedAssignees as { task_id: string; person_id: string }[]).forEach((a) => {
    const arr = aByTask.get(a.task_id) ?? []; arr.push(id2name.get(a.person_id) ?? a.person_id); aByTask.set(a.task_id, arr);
  });
  const tasks = (seedTasks as Omit<Task, "assignees">[]).map((t) => ({ ...t, assignees: aByTask.get(t.id) ?? [] }));
  const membersByProj = new Map<string, string[]>();
  (seedMembers as { project_id: string; person_id: string }[]).forEach((m) => {
    const arr = membersByProj.get(m.project_id) ?? []; arr.push(id2name.get(m.person_id) ?? m.person_id); membersByProj.set(m.project_id, arr);
  });
  const projects = (seedProjects as Omit<Project, "members" | "total" | "open">[]).map((p) => {
    const t = tasks.filter((x) => x.project_id === p.id);
    return { ...p, members: membersByProj.get(p.id) ?? [], total: t.length, open: t.filter((x) => x.status !== "done").length };
  });
  const people = (seedPeople as { id: string; name: string }[]).map((p) => ({
    ...p, open: tasks.filter((t) => t.assignees.includes(p.name) && t.status !== "done").length,
  }));
  return { projects, people, tasks };
}

export async function getWorkspace(): Promise<Workspace> {
  const sql = getSql();
  if (!sql) return fallback();
  try {
    await ensureReady(sql);
    const tasks = (await sql`
      SELECT t.id,t.project_id,t.title,t.status,t.priority,t.due,t.source_type,t.source_title,t.source_date,t.source_url,
        COALESCE(json_agg(p.name ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS assignees
      FROM tasks2 t LEFT JOIN task_assignees ta ON ta.task_id=t.id LEFT JOIN people p ON p.id=ta.person_id
      GROUP BY t.id ORDER BY (t.status='done'), t.source_date DESC NULLS LAST`) as Task[];
    const projects = (await sql`
      SELECT pr.id,pr.name,pr.status,pr.priority,pr.position,
        COALESCE(json_agg(DISTINCT pe.name) FILTER (WHERE pe.id IS NOT NULL), '[]'::json) AS members,
        (SELECT count(*)::int FROM tasks2 t WHERE t.project_id=pr.id) AS total,
        (SELECT count(*)::int FROM tasks2 t WHERE t.project_id=pr.id AND t.status<>'done') AS open
      FROM projects pr LEFT JOIN project_members pm ON pm.project_id=pr.id LEFT JOIN people pe ON pe.id=pm.person_id
      GROUP BY pr.id ORDER BY pr.position`) as Project[];
    const people = (await sql`
      SELECT pe.id, pe.name, count(*) FILTER (WHERE t.status<>'done')::int AS open
      FROM people pe LEFT JOIN task_assignees ta ON ta.person_id=pe.id LEFT JOIN tasks2 t ON t.id=ta.task_id
      GROUP BY pe.id ORDER BY open DESC`) as Person[];
    return { projects, people, tasks };
  } catch (err) {
    console.error("DB read failed, using seed fallback:", err);
    return fallback();
  }
}
