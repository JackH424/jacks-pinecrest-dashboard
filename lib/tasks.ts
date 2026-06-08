import seed from "@/data/seed_tasks.json";
import { getSql } from "./db";

export type Task = {
  id: string;
  title: string;
  assignee: string;
  stream: string;
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
    stream text NOT NULL DEFAULT 'General',
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
  // Migration: add stream column to pre-existing tables.
  await sql`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stream text NOT NULL DEFAULT 'General'`;
  await sql`CREATE TABLE IF NOT EXISTS _meta (key text PRIMARY KEY, val text)`;

  const payload = JSON.stringify(seed);
  const rows = (await sql`SELECT count(*)::int AS n FROM tasks`) as { n: number }[];
  if (rows[0]?.n === 0) {
    await sql`
      INSERT INTO tasks (id,title,assignee,stream,status,priority,due,source_type,source_title,source_date,source_url)
      SELECT id,title,assignee,stream,status,priority,due,source_type,source_title,source_date,source_url
      FROM json_to_recordset(${payload}::json) AS x(
        id text, title text, assignee text, stream text, status text, priority text, due text,
        source_type text, source_title text, source_date text, source_url text)
      ON CONFLICT (id) DO NOTHING`;
  }
  // One-time backfill of stream values for rows seeded before this column existed.
  const done = (await sql`SELECT 1 FROM _meta WHERE key = 'stream_backfill'`) as unknown[];
  if (done.length === 0) {
    await sql`
      UPDATE tasks t SET stream = s.stream
      FROM json_to_recordset(${payload}::json) AS s(id text, stream text)
      WHERE t.id = s.id`;
    await sql`INSERT INTO _meta (key, val) VALUES ('stream_backfill', '1') ON CONFLICT (key) DO NOTHING`;
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
      SELECT id,title,assignee,stream,status,priority,due,source_type,source_title,source_date,source_url
      FROM tasks
      ORDER BY (status = 'done'), source_date DESC NULLS LAST`) as Task[];
    return rows;
  } catch (err) {
    console.error("DB read failed, falling back to seed:", err);
    return seed as Task[];
  }
}
