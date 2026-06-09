#!/usr/bin/env node
// Pinecrest Mission Control — MCP server.
// Exposes task/project tools over stdio so an MCP-capable agent (Hermes/Codex)
// can read and modify mission control. Talks directly to the same Neon DB the
// dashboard uses, so changes show up instantly in the web app.
//
// Run via your agent's MCP config with env DATABASE_URL set to the Neon
// connection string (Vercel → Storage → your Neon DB → connection string).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const STATUS_MAP = {
  todo: "todo", "to do": "todo", "to-do": "todo", backlog: "todo",
  "in progress": "in_progress", in_progress: "in_progress", doing: "in_progress", working: "in_progress",
  waiting: "waiting", "on hold": "waiting", hold: "waiting",
  blocked: "blocked", stuck: "blocked", problem: "blocked",
  done: "done", complete: "done", completed: "done", finished: "done",
};
const normStatus = (s) => STATUS_MAP[(s || "").trim().toLowerCase()] || null;
const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });

async function ensure() {
  await sql`ALTER TABLE tasks2 ADD COLUMN IF NOT EXISTS description text DEFAULT ''`;
}
async function resolveProject(nameOrId) {
  if (!nameOrId) return "oneoff";
  const exact = await sql`SELECT id FROM projects WHERE id = ${nameOrId}`;
  if (exact.length) return exact[0].id;
  const m = await sql`SELECT id, name FROM projects WHERE name ILIKE ${"%" + nameOrId + "%"} ORDER BY length(name) LIMIT 5`;
  if (m.length === 1) return m[0].id;
  if (m.length === 0) return null;
  return { ambiguous: m };
}
async function resolvePerson(name) {
  const m = await sql`SELECT id, name FROM people WHERE name ILIKE ${"%" + name + "%"} LIMIT 5`;
  if (m.length === 1) return m[0];
  return m.length === 0 ? null : { ambiguous: m };
}
async function resolveTask(q) {
  const exact = await sql`SELECT id, title, project_id FROM tasks2 WHERE id = ${q}`;
  if (exact.length) return exact[0];
  const m = await sql`SELECT id, title, project_id FROM tasks2 WHERE title ILIKE ${"%" + q + "%"} ORDER BY length(title) LIMIT 6`;
  if (m.length === 1) return m[0];
  return m.length === 0 ? null : { ambiguous: m };
}
const genId = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

const server = new McpServer({ name: "pinecrest-mission-control", version: "0.1.0" });

server.registerTool("list_projects", { description: "List all projects with their open-task counts and ids.", inputSchema: {} },
  async () => text(await sql`SELECT pr.id, pr.name, (SELECT count(*)::int FROM tasks2 t WHERE t.project_id=pr.id AND t.status<>'done') AS open FROM projects pr ORDER BY pr.position`));

server.registerTool("list_people", { description: "List people (id + name) who tasks can be assigned to.", inputSchema: {} },
  async () => text(await sql`SELECT id, name FROM people ORDER BY name`));

server.registerTool("list_tasks", {
  description: "List tasks. Optionally filter by project (name or id), status, assignee name, or limit.",
  inputSchema: { project: z.string().optional(), status: z.string().optional(), assignee: z.string().optional(), limit: z.number().optional() },
}, async ({ project, status, assignee, limit }) => {
  let pid = null;
  if (project) { const r = await resolveProject(project); if (r && r.ambiguous) return text({ error: "ambiguous project", candidates: r.ambiguous }); pid = r; }
  const rows = await sql`
    SELECT t.id, t.title, t.status, t.due, t.project_id,
      COALESCE(json_agg(p.name) FILTER (WHERE p.id IS NOT NULL), '[]') AS assignees
    FROM tasks2 t LEFT JOIN task_assignees ta ON ta.task_id=t.id LEFT JOIN people p ON p.id=ta.person_id
    WHERE (${pid}::text IS NULL OR t.project_id = ${pid})
      AND (${status ? normStatus(status) : null}::text IS NULL OR t.status = ${status ? normStatus(status) : null})
    GROUP BY t.id ORDER BY t.status='done', t.due NULLS LAST LIMIT ${limit || 50}`;
  const filtered = assignee ? rows.filter((r) => (r.assignees || []).some((a) => a.toLowerCase().includes(assignee.toLowerCase()))) : rows;
  return text(filtered);
});

server.registerTool("create_task", {
  description: "Create a task. project = project name (omit or 'one-off' for a standalone task). assignee = person name. due = YYYY-MM-DD. status optional. description = rich context.",
  inputSchema: { title: z.string(), project: z.string().optional(), assignee: z.string().optional(), due: z.string().optional(), status: z.string().optional(), description: z.string().optional() },
}, async ({ title, project, assignee, due, status, description }) => {
  await ensure();
  const r = await resolveProject(project); if (r && r.ambiguous) return text({ error: "ambiguous project", candidates: r.ambiguous });
  const pid = r || "oneoff";
  const id = genId("n");
  await sql`INSERT INTO tasks2 (id, project_id, title, status, priority, due, source_type, description)
    VALUES (${id}, ${pid}, ${title}, ${normStatus(status) || "todo"}, 'normal', ${due || ""}, 'agent', ${description || ""})`;
  if (assignee) { const p = await resolvePerson(assignee); if (p && !p.ambiguous) await sql`INSERT INTO task_assignees (task_id, person_id) VALUES (${id}, ${p.id}) ON CONFLICT DO NOTHING`; }
  return text({ ok: true, id, project_id: pid });
});

server.registerTool("set_status", {
  description: "Set a task's status. task = task title or id. status one of: To Do, In Progress, Waiting, Blocked, Done.",
  inputSchema: { task: z.string(), status: z.string() },
}, async ({ task, status }) => {
  const s = normStatus(status); if (!s) return text({ error: "unknown status", allowed: ["To Do", "In Progress", "Waiting", "Blocked", "Done"] });
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  await sql`UPDATE tasks2 SET status=${s}, updated_at=now() WHERE id=${t.id}`;
  return text({ ok: true, id: t.id, status: s });
});

server.registerTool("set_due", {
  description: "Set or clear a task's due date. task = title or id. due = YYYY-MM-DD (empty string clears).",
  inputSchema: { task: z.string(), due: z.string() },
}, async ({ task, due }) => {
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  await sql`UPDATE tasks2 SET due=${due || ""}, updated_at=now() WHERE id=${t.id}`;
  return text({ ok: true, id: t.id, due });
});

server.registerTool("assign_task", {
  description: "Assign a person to a task. task = title or id. person = name. set remove=true to unassign.",
  inputSchema: { task: z.string(), person: z.string(), remove: z.boolean().optional() },
}, async ({ task, person, remove }) => {
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  const p = await resolvePerson(person); if (!p) return text({ error: "person not found" }); if (p.ambiguous) return text({ error: "ambiguous person", candidates: p.ambiguous });
  if (remove) await sql`DELETE FROM task_assignees WHERE task_id=${t.id} AND person_id=${p.id}`;
  else await sql`INSERT INTO task_assignees (task_id, person_id) VALUES (${t.id}, ${p.id}) ON CONFLICT DO NOTHING`;
  return text({ ok: true, task: t.id, person: p.name, removed: !!remove });
});

server.registerTool("move_task", {
  description: "Move a task to a different project. task = title or id. project = project name or id.",
  inputSchema: { task: z.string(), project: z.string() },
}, async ({ task, project }) => {
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  const r = await resolveProject(project); if (!r) return text({ error: "project not found" }); if (r.ambiguous) return text({ error: "ambiguous project", candidates: r.ambiguous });
  await sql`UPDATE tasks2 SET project_id=${r}, updated_at=now() WHERE id=${t.id}`;
  return text({ ok: true, id: t.id, project_id: r });
});

server.registerTool("update_task_details", {
  description: "Update a task's title and/or rich description. task = title or id.",
  inputSchema: { task: z.string(), title: z.string().optional(), description: z.string().optional() },
}, async ({ task, title, description }) => {
  await ensure();
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  if (title) await sql`UPDATE tasks2 SET title=${title}, updated_at=now() WHERE id=${t.id}`;
  if (description !== undefined) await sql`UPDATE tasks2 SET description=${description}, updated_at=now() WHERE id=${t.id}`;
  return text({ ok: true, id: t.id });
});

server.registerTool("add_comment", {
  description: "Post a comment/update on a task. task = title or id. Use @Name to mention someone.",
  inputSchema: { task: z.string(), body: z.string(), author: z.string().optional() },
}, async ({ task, body, author }) => {
  const t = await resolveTask(task); if (!t) return text({ error: "task not found" }); if (t.ambiguous) return text({ error: "ambiguous task", candidates: t.ambiguous });
  const mentions = Array.from(new Set((body.match(/@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g) || []).map((m) => m.slice(1))));
  await sql`INSERT INTO comments (id, target_type, target_id, author, body, mentions)
    VALUES (${genId("c")}, 'task', ${t.id}, ${author || "Hermes"}, ${body}, ${JSON.stringify(mentions)}::json)`;
  return text({ ok: true, task: t.id, mentions });
});

server.registerTool("create_project", {
  description: "Create a new project. Returns its id.",
  inputSchema: { name: z.string() },
}, async ({ name }) => {
  const id = genId("p");
  const pos = (await sql`SELECT COALESCE(max(position),0)+1 AS n FROM projects`)[0].n;
  await sql`INSERT INTO projects (id, name, status, priority, position) VALUES (${id}, ${name}, 'todo', 2, ${pos})`;
  return text({ ok: true, id, name });
});

async function main() {
  await ensure();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pinecrest Mission Control MCP server running (stdio).");
}
main().catch((e) => { console.error(e); process.exit(1); });
