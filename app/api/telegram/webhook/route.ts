import { getSql } from "@/lib/db";
import { TEAM } from "@/lib/team";
import { sendTelegram, telegramEnabled } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// Registration endpoint: each team member messages the bot once with their
// full name (as it appears in the dashboard) and we store their chat_id on
// the people row. Point Telegram here via setWebhook after the bot exists.
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!telegramEnabled()) return Response.json({ ok: false, error: "no bot token" });
  const sql = getSql();
  if (!sql) return Response.json({ ok: false, error: "no database" });

  let update: { message?: { chat?: { id?: number }; text?: string } };
  try {
    update = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" });
  }
  const chatId = update.message?.chat?.id;
  const text = (update.message?.text || "").trim();
  // Always 200 so Telegram doesn't retry forever on messages we ignore.
  if (!chatId || !text) return Response.json({ ok: true, ignored: true });

  // The people column is normally added by ensureReady on page load, but a
  // registration can arrive right after a fresh deploy — guard here too.
  await sql`ALTER TABLE people ADD COLUMN IF NOT EXISTS telegram_chat_id text DEFAULT ''`;

  const name = TEAM.find((n) => n.toLowerCase() === text.toLowerCase().replace(/^\/start\s*/, "").trim());
  if (!name) {
    await sendTelegram(String(chatId), `Hi! To get dashboard notifications, reply with your full name exactly as it appears in the dashboard:\n${TEAM.join("\n")}`);
    return Response.json({ ok: true, registered: false });
  }
  const rows = (await sql`UPDATE people SET telegram_chat_id = ${String(chatId)} WHERE lower(name) = ${name.toLowerCase()} RETURNING id`) as unknown[];
  if (!rows.length) {
    await sendTelegram(String(chatId), `Sorry — I couldn't find "${name}" in the dashboard. Ask Jack to check.`);
    return Response.json({ ok: true, registered: false });
  }
  await sendTelegram(String(chatId), `You're registered, ${name}! You'll get a DM when someone @mentions you and when your tasks are due.`);
  return Response.json({ ok: true, registered: true });
}
