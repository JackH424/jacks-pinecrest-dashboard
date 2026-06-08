"use server";

import { getSql } from "@/lib/db";
import { revalidatePath } from "next/cache";

const STATUSES = new Set(["todo", "doing", "done"]);

export async function setStatus(id: string, status: string) {
  if (!STATUSES.has(status)) return { ok: false, error: "bad status" };
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database connected yet" };
  await sql`UPDATE tasks SET status = ${status}, updated_at = now() WHERE id = ${id}`;
  revalidatePath("/");
  return { ok: true };
}

export async function reassign(id: string, assignee: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database connected yet" };
  await sql`UPDATE tasks SET assignee = ${assignee || "Unassigned"}, updated_at = now() WHERE id = ${id}`;
  revalidatePath("/");
  return { ok: true };
}

export async function setStream(id: string, stream: string) {
  const sql = getSql();
  if (!sql) return { ok: false, error: "no database connected yet" };
  await sql`UPDATE tasks SET stream = ${stream || "General"}, updated_at = now() WHERE id = ${id}`;
  revalidatePath("/");
  return { ok: true };
}
