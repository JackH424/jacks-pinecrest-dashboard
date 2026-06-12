// Telegram DMs. Dormant until TELEGRAM_BOT_TOKEN is set in Vercel (same
// activation pattern as the triage cron's GITHUB_TOKEN). Failures are
// swallowed — a Telegram outage must never break a comment or cron run.

export function telegramEnabled(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
