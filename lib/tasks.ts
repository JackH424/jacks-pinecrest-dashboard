import seed from "@/data/seed_tasks.json";
import { getSql } from "./db";

export type Task = {
  id: string;
  title: string;
  assignee: string;
  status: "todo" | "doing" | "done";
  priority: "low" | "normal" | "high";
  due: string;
  source_type: string;
  source_title: string;
  source_date: string;
  source_url: string;
};

export const PRIMARY_USER = "Jack Harris";

let ready = false;

// Create the table on first use and seed it from the KB action items if empty.
// Idempotent: safe to call on every request; only seeds when the table is empty.
async function ensureReady(sql: NonNullable<ReturnType<typeof getSql>>) {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS tasks (
    id text PRIMARY KEY,
    title text NOT NULL,
    assignee text NOT NULL DEFAULT 'Unassigned',
    status text NOT NULL DEFAULT 'todo',
    priority text NOT NULL DEFAULT 'normal',
    due text DEFAULT '',
    source_type text DEFAULT 'manual',
    source_title text DEFAULT '',
    source_date text DEFAULT '',
    source_url text DEFAULT '',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  )`;
  const rows = (await sql`SELECT count(*)::int AS n FROM tasks`) as { n: number }[];
  if (rows[0]?.n === 0) {
    const payload = JSON.stringify(seed);
    await sql`
      INSERT INTO tasks (id,title,assignee,status,priority,due,source_type,source_title,source_date,source_url)
      SELECT id,title,assignee,status,priority,due,source_type,source_title,source_date,source_url
      FROM json_to_recordset(${payload}::json) AS x(
        id text, title text, assignee text, status text, priority text, due text,
        source_type text, source_title text, source_date text, source_url text)
      ON CONFLICT (id) DO NOTHING`;
  }
  ready = true;
}

export async function getTasks(): Promise<Task[]> {
  const sql = getSql();
  if (!sql) {
    // Pre-database fallback: serve the seed file directly.
    return (seed as Task[]).slice().sort((a, b) =>
      (b.source_date || "").localeCompare(a.source_date || "")
    );
  }
  try {
    await ensureReady(sql);
    const rows = (await sql`
      SELECT id,title,assignee,status,priority,due,source_type,source_title,source_date,source_url
      FROM tasks
      ORDER BY (status = 'done'), source_date DESC NULLS LAST`) as Task[];
    return rows;
  } catch (err) {
    console.error("DB read failed, falling back to seed:", err);
    return seed as Task[];
  }
}
