/**
 * Emissor de alerta operacional (sync congelado, token vencido, etc).
 *
 * INERTE por padrão: sem ALERT_WEBHOOK_URL não faz nada (não "coloca em produção"
 * até você configurar o canal). Best-effort: nunca lança — alerta é acessório, não
 * pode derrubar o cron que o dispara.
 *
 * Compatível com:
 *   - Telegram: ALERT_WEBHOOK_URL = https://api.telegram.org/bot<TOKEN>/sendMessage
 *               + ALERT_CHAT_ID = <chat id>
 *   - Qualquer webhook (n8n/Slack-compat/etc) que aceite JSON { text }.
 */
export async function sendAlert(text: string): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return false
  const chatId = process.env.ALERT_CHAT_ID
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatId ? { chat_id: chatId, text } : { text }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}
