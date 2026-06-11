import OpenAI from "openai";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OpenAIKey || process.env.OPENAIKEY;

const STATUS_MAP: Record<string, string> = {
  "to do": "todo", todo: "todo", backlog: "todo",
  "in progress": "in_progress", doing: "in_progress", working: "in_progress",
  waiting: "waiting", "on hold": "waiting",
  blocked: "blocked", stuck: "blocked",
  done: "done", complete: "done", completed: "done",
};
const normStatus = (s: string) => STATUS_MAP[(s || "").trim().toLowerCase()] || null;
const genId = (p: string) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

type Sql = NonNullable<ReturnType<typeof getSql>>;
async function resolveProject(sql: Sql, q?: string) {
  if (!q) return "oneoff";
  const e = await sql`SELECT id FROM projects WHERE id=${q}`;
  if (e.length) return e[0].id as string;
  const m = await sql`SELECT id,name FROM projects WHERE name ILIKE ${"%" + q + "%"} ORDER BY length(name) LIMIT 3`;
  return m.length ? (m[0].id as string) : null;
}
async function resolvePerson(sql: Sql, q: string) {
  const m = await sql`SELECT id,name FROM people WHERE name ILIKE ${"%" + q + "%"} LIMIT 3`;
  return m.length ? m[0] : null;
}
async function resolveTask(sql: Sql, q: string) {
  const e = await sql`SELECT id,title FROM tasks2 WHERE id=${q}`;
  if (e.length) return e[0];
  const m = await sql`SELECT id,title FROM tasks2 WHERE title ILIKE ${"%" + q + "%"} ORDER BY length(title) LIMIT 5`;
  if (m.length === 1) return m[0];
  return m.length === 0 ? null : { ambiguous: m };
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "list_projects", description: "List projects with open-task counts.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "list_tasks", description: "List tasks, optionally filtered.", parameters: { type: "object", properties: { project: { type: "string" }, status: { type: "string" }, assignee: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "create_task", description: "Create a task. project=name (omit for one-off). assignee=name. due=YYYY-MM-DD. description=rich context.", parameters: { type: "object", properties: { title: { type: "string" }, project: { type: "string" }, assignee: { type: "string" }, due: { type: "string" }, status: { type: "string" }, description: { type: "string" } }, required: ["title"] } } },
  { type: "function", function: { name: "set_status", description: "Set a task status (To Do/In Progress/Waiting/Blocked/Done).", parameters: { type: "object", properties: { task: { type: "string" }, status: { type: "string" } }, required: ["task", "status"] } } },
  { type: "function", function: { name: "set_due", description: "Set/clear a task due date (YYYY-MM-DD or empty).", parameters: { type: "object", properties: { task: { type: "string" }, due: { type: "string" } }, required: ["task", "due"] } } },
  { type: "function", function: { name: "assign_task", description: "Assign (or with remove=true unassign) a person to a task.", parameters: { type: "object", properties: { task: { type: "string" }, person: { type: "string" }, remove: { type: "boolean" } }, required: ["task", "person"] } } },
  { type: "function", function: { name: "move_task", description: "Move a task to a project.", parameters: { type: "object", properties: { task: { type: "string" }, project: { type: "string" } }, required: ["task", "project"] } } },
  { type: "function", function: { name: "add_comment", description: "Post a comment on a task; use @Name to ping.", parameters: { type: "object", properties: { task: { type: "string" }, body: { type: "string" } }, required: ["task", "body"] } } },
  { type: "function", function: { name: "create_project", description: "Create a new project.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } },
];

async function exec(sql: Sql, name: string, a: Record<string, unknown>): Promise<string> {
  const s = (k: string) => (a[k] == null ? "" : String(a[k]));
  switch (name) {
    case "list_projects":
      return JSON.stringify(await sql`SELECT pr.name,(SELECT count(*)::int FROM tasks2 t WHERE t.project_id=pr.id AND t.status<>'done') AS open FROM projects pr ORDER BY pr.position`);
    case "list_tasks": {
      const pid = a.project ? await resolveProject(sql, s("project")) : null;
      const st = a.status ? normStatus(s("status")) : null;
      const rows = await sql`SELECT t.id,t.title,t.status,t.due,COALESCE(json_agg(p.name) FILTER (WHERE p.id IS NOT NULL),'[]') AS assignees FROM tasks2 t LEFT JOIN task_assignees ta ON ta.task_id=t.id LEFT JOIN people p ON p.id=ta.person_id WHERE (${pid}::text IS NULL OR t.project_id=${pid}) AND (${st}::text IS NULL OR t.status=${st}) GROUP BY t.id LIMIT ${Number(a.limit) || 40}`;
      return JSON.stringify(rows);
    }
    case "create_task": {
      const pid = (await resolveProject(sql, s("project"))) || "oneoff";
      const id = genId("n");
      await sql`INSERT INTO tasks2 (id,project_id,title,status,priority,due,source_type,description) VALUES (${id},${pid},${s("title")},${normStatus(s("status")) || "todo"},'normal',${s("due")},'agent',${s("description")})`;
      if (a.assignee) { const p = await resolvePerson(sql, s("assignee")); if (p) await sql`INSERT INTO task_assignees (task_id,person_id) VALUES (${id},${p.id}) ON CONFLICT DO NOTHING`; }
      return `Created task "${s("title")}" (id ${id}).`;
    }
    case "set_status": {
      const t = await resolveTask(sql, s("task")); if (!t) return "Task not found."; if ("ambiguous" in t) return "Ambiguous task: " + JSON.stringify(t.ambiguous);
      const st = normStatus(s("status")); if (!st) return "Unknown status.";
      await sql`UPDATE tasks2 SET status=${st},updated_at=now() WHERE id=${t.id}`; return `Set "${t.title}" to ${st}.`;
    }
    case "set_due": {
      const t = await resolveTask(sql, s("task")); if (!t) return "Task not found."; if ("ambiguous" in t) return "Ambiguous: " + JSON.stringify(t.ambiguous);
      await sql`UPDATE tasks2 SET due=${s("due")},updated_at=now() WHERE id=${t.id}`; return `Set due of "${t.title}" to ${s("due") || "(none)"}.`;
    }
    case "assign_task": {
      const t = await resolveTask(sql, s("task")); if (!t) return "Task not found."; if ("ambiguous" in t) return "Ambiguous: " + JSON.stringify(t.ambiguous);
      const p = await resolvePerson(sql, s("person")); if (!p) return "Person not found.";
      if (a.remove) await sql`DELETE FROM task_assignees WHERE task_id=${t.id} AND person_id=${p.id}`;
      else await sql`INSERT INTO task_assignees (task_id,person_id) VALUES (${t.id},${p.id}) ON CONFLICT DO NOTHING`;
      return `${a.remove ? "Unassigned" : "Assigned"} ${p.name} ${a.remove ? "from" : "to"} "${t.title}".`;
    }
    case "move_task": {
      const t = await resolveTask(sql, s("task")); if (!t) return "Task not found."; if ("ambiguous" in t) return "Ambiguous: " + JSON.stringify(t.ambiguous);
      const pid = await resolveProject(sql, s("project")); if (!pid) return "Project not found.";
      await sql`UPDATE tasks2 SET project_id=${pid},updated_at=now() WHERE id=${t.id}`; return `Moved "${t.title}".`;
    }
    case "add_comment": {
      const t = await resolveTask(sql, s("task")); if (!t) return "Task not found."; if ("ambiguous" in t) return "Ambiguous: " + JSON.stringify(t.ambiguous);
      const mentions = Array.from(new Set((s("body").match(/@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g) || []).map((m) => m.slice(1))));
      await sql`INSERT INTO comments (id,target_type,target_id,author,body,mentions) VALUES (${genId("c")},'task',${t.id},'AI Assistant',${s("body")},${JSON.stringify(mentions)}::json)`;
      return `Comment added to "${t.title}".`;
    }
    case "create_project": {
      const id = genId("p"); const pos = (await sql`SELECT COALESCE(max(position),0)+1 AS n FROM projects`)[0].n;
      await sql`INSERT INTO projects (id,name,status,priority,position) VALUES (${id},${s("name")},'todo',2,${pos})`;
      return `Created project "${s("name")}".`;
    }
    default: return "Unknown tool.";
  }
}

const SYSTEM = `You are the assistant for Pinecrest Mission Control, a task/project manager for an insurance team.
Use the tools to create and update tasks and projects when the user describes work, meetings, or updates.
Statuses are: To Do, In Progress, Waiting, Blocked, Done. Reference projects and people by name — the tools resolve them.
When the user gives meeting context, create well-described tasks (use the description field for rich context). Be concise; confirm what you did.`;

export async function POST(req: Request) {
  if (!OPENAI_KEY) return Response.json({ reply: "OpenAI key not configured. Add OPENAI_API_KEY (or OpenAIKey) in Vercel." });
  const sql = getSql();
  if (!sql) return Response.json({ reply: "Database not connected." });
  const body = await req.json().catch(() => ({}));
  const history = Array.isArray(body.messages) ? body.messages : [];
  const client = new OpenAI({ apiKey: OPENAI_KEY });
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    ...history.map((m: { role: string; content: string }) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam)),
  ];

  let changed = false;
  try {
    for (let step = 0; step < 6; step++) {
      const r = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS, tool_choice: "auto" });
      const msg = r.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return Response.json({ reply: msg.content || "Done.", changed });
      }
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch {}
        if (!["list_projects", "list_tasks"].includes(call.function.name)) changed = true;
        const result = await exec(sql, call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    return Response.json({ reply: "Reached step limit — some actions may be incomplete.", changed });
  } catch (e: unknown) {
    return Response.json({ reply: "Error: " + (e instanceof Error ? e.message : String(e)) });
  }
}
