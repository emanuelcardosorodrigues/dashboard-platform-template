/**
 * GET /api/cron/push-fadiga — push quando um criativo VIRA "saturado" (fadigado).
 * Dispara SÓ na transição: compara os saturados de agora contra o snapshot
 * `fadiga_notificacoes` e avisa apenas os NOVOS. Anúncio que recuperou (saiu de
 * saturado) some do snapshot → volta a alertar se re-saturar. Nada de spam diário.
 *
 * "Fadigado" = fadiga_status = 'saturado' (o sinal mais acionável; 'atencao' é aviso
 * mais brando e ruidoso, fica de fora de propósito).
 *
 * A fadiga é recalculada externamente ~06:16 UTC; agendado 0 7 * * * (07h UTC = 04h BRT),
 * depois do cálculo. Auth: x-vercel-cron ou Bearer CRON_SECRET.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LST_WS = 'faafca5a-fb53-404f-8469-499d8869944c'

function authed(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const client = supa()

  // Saturados de agora (sempre filtrado por workspace — tenant-isolation).
  const { data: saturadosRaw, error: satErr } = await client
    .from('criativo_analise')
    .select('ad_id, ad_name, fadiga_status')
    .eq('workspace_id', LST_WS)
    .eq('fadiga_status', 'saturado')
  if (satErr) return NextResponse.json({ error: satErr.message }, { status: 500 })

  const saturados = (saturadosRaw ?? []).filter((r) => r.ad_id)
  const saturadoIds = new Set(saturados.map((r) => r.ad_id as string))

  // Snapshot do que já foi avisado.
  const { data: notifRaw, error: notifErr } = await client
    .from('fadiga_notificacoes')
    .select('ad_id')
    .eq('workspace_id', LST_WS)
  if (notifErr) return NextResponse.json({ error: notifErr.message }, { status: 500 })
  const notificados = new Set((notifRaw ?? []).map((r) => r.ad_id as string))

  // Recuperados: estavam no snapshot mas não estão mais saturados → limpa (re-alerta no futuro).
  const recuperados = [...notificados].filter((id) => !saturadoIds.has(id))
  if (recuperados.length) {
    await client.from('fadiga_notificacoes').delete().eq('workspace_id', LST_WS).in('ad_id', recuperados)
  }

  // Novos: saturados agora que ainda não foram avisados.
  const novos = saturados.filter((r) => !notificados.has(r.ad_id as string))
  let sent = 0
  if (novos.length) {
    const nomes = novos.map((r) => (r.ad_name as string) || (r.ad_id as string))
    const lista = nomes.slice(0, 3).join(' · ')
    const resto = nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ''
    const body =
      novos.length === 1
        ? `${nomes[0]} está saturado — hora de renovar o criativo.`
        : `${novos.length} criativos saturados: ${lista}${resto}.`

    // F6 anti-rajada: JÁ consolidado — mesmo com N novos, isto é UM push (o body
    // acima junta a lista; nada de 1 notificação por criativo). Só a TRANSIÇÃO
    // dispara (snapshot fadiga_notificacoes), então não há rajada diária tampouco.
    //
    // F6 deep-link: 1 novo → cai direto no criativo; vários → abre a lista já no
    // recorte de 7d. O SW navega pra data.url; o consumo de `criativo`/`preset` no
    // CriativosIaClient é da esteira da UI (fora do escopo deste emissor).
    const deepLink =
      novos.length === 1
        ? `/criativos-ia?criativo=${encodeURIComponent(novos[0].ad_id as string)}&preset=7d`
        : `/criativos-ia?preset=7d`
    sent = await sendPush({ title: '🥵 Criativo fadigado', body, url: deepLink, tag: 'fadiga' })

    const rows = novos.map((r) => ({ workspace_id: LST_WS, ad_id: r.ad_id as string, status: 'saturado' }))
    await client.from('fadiga_notificacoes').upsert(rows, { onConflict: 'workspace_id,ad_id' })
  }

  return NextResponse.json({ ok: true, saturados: saturados.length, novos: novos.length, recuperados: recuperados.length, sent })
}
