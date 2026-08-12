import { log } from '@/lib/log'

const RESEND_API_URL = 'https://api.resend.com/emails'
const FROM_DEFAULT = process.env.EMAIL_FROM || 'noreply-dash@example.com'
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Dashboard DEMO'

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  skipped?: boolean
  error?: string
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    log.warn('email.skipped', { reason: 'no_resend_api_key', subject: input.subject })
    return { ok: false, skipped: true, error: 'RESEND_API_KEY not configured' }
  }

  const from = input.from || `${FROM_NAME} <${FROM_DEFAULT}>`
  const payload = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text ?? stripHtml(input.html),
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) {
      log.warn('email.send.failed', { status: res.status, message: body?.message })
      return { ok: false, error: body?.message || `HTTP ${res.status}` }
    }
    log.info('email.sent', { id: body?.id, subject: input.subject })
    return { ok: true, id: body?.id }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('email.send.exception', { message: msg })
    return { ok: false, error: msg }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface TempPasswordEmailInput {
  to: string
  name?: string | null
  tempPassword: string
  loginUrl: string
}

export async function sendTempPasswordEmail(input: TempPasswordEmailInput): Promise<SendEmailResult> {
  const greet = input.name ? `Olá, ${input.name}` : 'Olá'
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Acesso ao Dashboard DEMO</title>
</head>
<body style="margin:0;padding:32px;background:#E8EAE3;font-family:'DM Sans',-apple-system,system-ui,sans-serif;color:#121721">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:20px;border:1px solid rgba(0,0,0,0.06);box-shadow:0 8px 32px rgba(0,0,0,0.08)">
    <tr><td style="padding:32px">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.01em">Seu acesso está pronto</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#6B7280">${greet}, seu acesso ao Dashboard DEMO foi criado.</p>
      <div style="background:#F9FAF7;border:1px solid rgba(0,0,0,0.06);border-radius:12px;padding:16px 18px;margin-bottom:24px">
        <p style="margin:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF">Senha temporária</p>
        <p style="margin:0;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.04em;color:#121721;font-weight:600">${escapeHtml(input.tempPassword)}</p>
      </div>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280">Use essa senha pra entrar e troque por uma sua na tela de onboarding.</p>
      <a href="${escapeAttr(input.loginUrl)}" style="display:inline-block;background:#121721;color:#FFFFFF;padding:12px 24px;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">Acessar dashboard</a>
      <p style="margin:32px 0 0;font-size:12px;color:#9CA3AF">Se você não esperava esse email, ignore.</p>
    </td></tr>
  </table>
</body>
</html>`

  return sendEmail({
    to: input.to,
    subject: 'Seu acesso ao Dashboard DEMO',
    html,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
function escapeAttr(s: string): string {
  return escapeHtml(s)
}
