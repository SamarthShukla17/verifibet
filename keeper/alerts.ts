/**
 * The one place that actually calls Telegram's `sendMessage` API. Split out
 * of `keeper/resolver.ts` (where this originated) so `keeper/index.ts`'s
 * own tick loop can fire alerts too (low SOL balance — see its own doc
 * comment) without either module reaching into the other's internals.
 */
import type pino from "pino";

export async function telegramAlert(logger: pino.Logger, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    logger.warn({ text }, "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured — alert not sent, see text above");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      logger.error({ status: res.status, body: await res.text() }, "Telegram alert API call failed");
    }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, "Telegram alert threw");
  }
}
