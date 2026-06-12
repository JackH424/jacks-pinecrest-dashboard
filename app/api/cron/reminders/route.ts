import { getSql } from "@/lib/db";
import { sendTelegram, telegramEnabled } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Daily cron: for every not-done task that is due today or overdue and has
// assignees, post an internal reminder comment that @mentions each assignee
// (shows up in their Messages). Idempotent per task+person+day via the id.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, error: "no database" });

  const today = new Date().toISOString().slice(0, 10);
  const ymd = today.replace(/-/g, "");

  // Cron can fire before any page load after a fresh deploy adds the column.
  await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_chat_id text DEFAULT ''`;

  const rows = (await sql`
    SELECT t.id AS task_id, t.title, t.due, p.id AS pid, p.name AS assignee, p.telegram_chat_id
    FROM tasks2 t
    JOIN task_assignees ta ON ta.task_id = t.id
    JOIN people p ON p.id = ta.person_id
    WHERE t.status <> 'done' AND t.due <> '' AND t.due <= ${today}`) as
    { task_id: string; title: string; due: string; pid: string; assignee: string; telegram_chat_id: string }[];

  let posted = 0, dms = 0;
  for (const r of rows) {
    const id = `rem-${r.task_id}-${r.pid}-${ymd}`;
    const overdue = r.due < today;
    const body = `Reminder: @${r.assignee} — "${r.title}" ${overdue ? "is OVERDUE" : "is due today"} (due ${r.due}).`;
    const res = await sql`INSERT INTO comments (id,target_type,target_id,author,body,mentions)
      VALUES (${id}, 'task', ${r.task_id}, 'System', ${body}, ${JSON.stringify([r.assignee])}::json)
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if ((res as unknown[]).length) {
      posted++;
      // DM mirrors the comment; only on first insert so re-runs don't re-ping.
      if (telegramEnabled() && r.telegram_chat_id) {
        if (await sendTelegram(r.telegram_chat_id, body.replace(`@${r.assignee} — `, ""))) dms++;
      }
    }
  }
  return Response.json({ ok: true, candidates: rows.length, reminders_posted: posted, telegram_dms: dms });
}
