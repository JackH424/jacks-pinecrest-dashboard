"use server";

import { getSql } from "@/lib/db";
import { revalidatePath } from "next/cache";

const STATUSES = new Set(["todo", "doing", "done"]);

export async function setStatus(taskId: string, status: string) {
  if (!STATUSES.has(status)) return { ok: false };
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database" };
  await sql`UPDATE tasks2 SET status = ${status}, updated_at = now() WHERE id = ${taskId}`;
  revalidatePath("/");
  return { ok: true };
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
