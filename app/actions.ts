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
    // Dependencies: unblock dependents whose blockers are now all done.
    await sql`UPDATE tasks2 SET status='todo', updated_at=now()
      WHERE status='blocked' AND id IN (SELECT task_id FROM task_deps WHERE blocks_on=${taskId})
      AND NOT EXISTS (
        SELECT 1 FROM task_deps d JOIN tasks2 b ON b.id=d.blocks_on
        WHERE d.task_id=tasks2.id AND b.status<>'done')`;
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

export async function addChecklistItem(taskId: string, text: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  const t = (text || "").trim();
  if (!t) return { ok: false };
  const id = "cl" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  const pos = ((await sql`SELECT COALESCE(max(pos),0)+1 AS n FROM checklist_items WHERE task_id=${taskId}`) as { n: number }[])[0].n;
  await sql`INSERT INTO checklist_items (id, task_id, text, pos) VALUES (${id}, ${taskId}, ${t}, ${pos})`;
  revalidatePath("/");
  return { ok: true, id };
}

export async function toggleChecklistItem(id: string, done: boolean) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE checklist_items SET done = ${done} WHERE id = ${id}`;
  revalidatePath("/");
  return { ok: true };
}

export async function deleteChecklistItem(id: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`DELETE FROM checklist_items WHERE id = ${id}`;
  revalidatePath("/");
  return { ok: true };
}

export async function addDep(taskId: string, blocksOn: string) {
  const sql = getSql();
  if (!sql || taskId === blocksOn) return { ok: false };
  await sql`INSERT INTO task_deps (task_id, blocks_on) VALUES (${taskId}, ${blocksOn}) ON CONFLICT DO NOTHING`;
  // If the dependency is still open, the task is blocked.
  const open = (await sql`SELECT 1 FROM tasks2 WHERE id=${blocksOn} AND status<>'done'`) as unknown[];
  if (open.length) await sql`UPDATE tasks2 SET status='blocked', updated_at=now() WHERE id=${taskId}`;
  revalidatePath("/");
  return { ok: true, blocked: open.length > 0 };
}

export async function removeDep(taskId: string, blocksOn: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`DELETE FROM task_deps WHERE task_id=${taskId} AND blocks_on=${blocksOn}`;
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
