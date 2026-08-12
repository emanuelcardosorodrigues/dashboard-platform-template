/**
 * Web Push (A-F6). Envia notificação pras inscrições do workspace (VAPID).
 * INERTE sem VAPID_* no env (não quebra nada até configurar). Best-effort: nunca
 * lança — o caller (webhook/cron) não pode cair por causa de push. Inscrição morta
 * (404/410) é limpa da tabela.
 */
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import { log } from './log'

const LST_WS = 'faafca5a-fb53-404f-8469-499d8869944c'

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

let vapidSet = false
function ensureVapid() {
  if (vapidSet || !pushConfigured()) return
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
  vapidSet = true
}

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/** Envia pra todas as inscrições do workspace. Retorna quantas foram entregues. */
export async function sendPush(payload: PushPayload, workspaceId: string = LST_WS): Promise<number> {
  if (!pushConfigured()) return 0
  ensureVapid()
  const sb = supa()
  const { data, error } = await sb
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('workspace_id', workspaceId)
  if (error) {
    log.warn('sendPush: falha ao ler inscrições', { msg: error.message })
    return 0
  }
  const subs = (data ?? []) as { id: number; endpoint: string; p256dh: string; auth: string }[]
  if (!subs.length) return 0

  const body = JSON.stringify(payload)
  const dead: number[] = []
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body)
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) dead.push(s.id)
        else log.warn('sendPush: envio falhou', { id: s.id, code })
      }
    }),
  )
  if (dead.length) await sb.from('push_subscriptions').delete().in('id', dead)
  return sent
}
