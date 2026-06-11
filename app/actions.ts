"use server";

import { getSql } from "@/lib/db";
import { STATUS_IDS } from "@/lib/statuses";
import { revalidatePath } from "next/cache";

const STATUSES = new Set(STATUS_IDS);

function nextDue(due: string, repeat: string): string {
  const base = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(due + "T00:00:00Z") : new Date();
  if (repeat === "daily") base.setUTCDate(base.getUTCDate() + 1);
  else if (repeat === "weekly") base.setUTCDate(base.getUTCDate() + 7);
  else if (repeat === "monthly") base.setUTCMonth(base.getUTCMonth() + 1);
  return base.toISOString().slice(0, 10);
}

export async function setStatus(taskId: string, status: string) {
  if (!STATUSES.has(status)) return { ok: false };
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET status = ${status}, updated_at = now() WHERE id = ${taskId}`;
  // Recurring: completing a repeating task spawns the next instance.
  if (status === "done") {
    const rows = (await sql`SELECT project_id,title,priority,due,description,COALESCE(repeat,'') AS repeat FROM tasks2 WHERE id = ${taskId}`) as
      { project_id: string; title: string; priority: string; due: string; description: string; repeat: string }[];
    const t = rows[0];
    if (t && ["daily", "weekly", "monthly"].includes(t.repeat)) {
      const id = "n" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      await sql`INSERT INTO tasks2 (id,project_id,title,status,priority,due,source_type,description,repeat)
        VALUES (${id},${t.project_id},${t.title},'todo',${t.priority},${nextDue(t.due, t.repeat)},'recurring',${t.description},${t.repeat})`;
      await sql`INSERT INTO task_assignees (task_id,person_id) SELECT ${id},person_id FROM task_assignees WHERE task_id=${taskId} ON CONFLICT DO NOTHING`;
      await sql`UPDATE tasks2 SET repeat='' WHERE id=${taskId}`;
    }
  }
  revalidatePath("/");
  return { ok: true };
}

const REPEATS = new Set(["", "daily", "weekly", "monthly"]);
export async function setRepeat(taskId: string, repeat: string) {
  if (!REPEATS.has(repeat)) return { ok: false };
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET repeat = ${repeat}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function addTask(title: string, projectId: string, assigneeIds: string[]) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  const t = (title || "").trim();
  if (!t) return { ok: false, error: "empty" };
  const id = "n" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  await sql`INSERT INTO tasks2 (id, project_id, title, status, priority, source_type)
    VALUES (${id}, ${projectId || "oneoff"}, ${t}, 'todo', 'normal', 'manual')`;
  for (const pid of assigneeIds || []) {
    if (pid) await sql`INSERT INTO task_assignees (task_id, person_id) VALUES (${id}, ${pid}) ON CONFLICT DO NOTHING`;
  }
  revalidatePath("/");
  return { ok: true, id };
}

export async function toggleAssignee(taskId: string, personId: string, on: boolean) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  if (on) {
    await sql`INSERT INTO task_assignees (task_id, person_id) VALUES (${taskId}, ${personId}) ON CONFLICT DO NOTHING`;
  } else {
    await sql`DELETE FROM task_assignees WHERE task_id = ${taskId} AND person_id = ${personId}`;
  }
  revalidatePath("/");
  return { ok: true };
}

export async function moveTask(taskId: string, projectId: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET project_id = ${projectId}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
export async function setPriority(taskId: string, priority: string) {
  if (!PRIORITIES.has(priority)) return { ok: false };
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET priority = ${priority}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function setDescription(taskId: string, description: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET description = ${description}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function setDue(taskId: string, due: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET due = ${due || ""}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function renameProject(projectId: string, name: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  const n = (name || "").trim();
  if (!n) return { ok: false, error: "empty" };
  await sql`UPDATE projects SET name = ${n} WHERE id = ${projectId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function updateTaskTitle(taskId: string, title: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  const t = (title || "").trim();
  if (!t) return { ok: false, error: "empty" };
  await sql`UPDATE tasks2 SET title = ${t}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
}

export async function markRead(personId: string, commentIds: string[]) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  for (const cid of (commentIds || []).slice(0, 500)) {
    await sql`INSERT INTO comment_reads (person_id, comment_id) VALUES (${personId}, ${cid}) ON CONFLICT DO NOTHING`;
  }
  return { ok: true };
}

export async function addComment(
  targetType: "task" | "project", targetId: string, author: string, body: string
) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  const text = (body || "").trim();
  if (!text) return { ok: false, error: "empty" };
  const mentions = Array.from(
    new Set((text.match(/@([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g) || []).map((m) => m.slice(1)))
  );
  const id = "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  await sql`INSERT INTO comments (id,target_type,target_id,author,body,mentions)
    VALUES (${id}, ${targetType}, ${targetId}, ${author}, ${text}, ${JSON.stringify(mentions)}::json)`;
  revalidatePath("/");
  return { ok: true, id, mentions };
}
