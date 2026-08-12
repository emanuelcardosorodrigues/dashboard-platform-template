/**
 * POST /api/push/test — envia um push de confirmação pras inscrições do workspace.
 * Chamado logo após ativar, pra o usuário ver que funcionou na hora.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function POST(req: NextRequest) {
  const client = supa()
  const a = await requireAuth(req, client)
  if ('error' in a) return a.error
  const sent = await sendPush(
    { title: '🔔 Notificações ativas', body: 'Vendas, alertas e resumo diário chegam aqui.', url: '/', tag: 'teste' },
    a.ws.id,
  )
  return NextResponse.json({ ok: true, sent })
}
