import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { audit } from '@/lib/audit'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { parseQuery, badRequest, backfillSckQuerySchema } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'

const HOTMART_AUTH_URL = 'https://api-sec-vlc.hotmart.com/security/oauth/token'
const HOTMART_SALES_HISTORY_URL = 'https://developers.hotmart.com/payments/api/v1/sales/history'

async function getHotmartToken(): Promise<string | null> {
  const clientId = process.env.HOTMART_CLIENT_ID?.trim()
  const clientSecret = process.env.HOTMART_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${HOTMART_AUTH_URL}?grant_type=client_credentials`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const json = await res.json() as { access_token?: string }
  return json.access_token ?? null
}

async function fetchSckForTransaction(token: string, hotmartId: string): Promise<string> {
  const url = new URL(HOTMART_SALES_HISTORY_URL)
  url.searchParams.set('transaction', hotmartId)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return ''
  const json = await res.json() as {
    items?: Array<{ purchase?: { tracking?: { source_sck?: string } } }>
  }
  const rawSck = String(json.items?.[0]?.purchase?.tracking?.source_sck ?? '')
  if (!rawSck) return ''
  const p = rawSck.split('|')
  return p[0] && p[0] !== '0' ? p[0] : ''
}

export async function POST(req: NextRequest) {
  // Defense in depth: session admin OBRIGATÓRIA. x-admin-secret continua como
  // segunda camada (uso CLI fora do navegador) mas só vale junto com session admin
  // — sem session, recusa mesmo com secret correto.
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Busca transações sem sck_slug (ou vazias), opcionalmente filtradas por data
  const parsedQuery = parseQuery(req.url, backfillSckQuerySchema)
  if (!parsedQuery.ok) {
    const r = badRequest(parsedQuery)
    return NextResponse.json(r.body, { status: r.status })
  }
  const dataFiltro = parsedQuery.data.data ?? null // ex: 2026-04-26

  // Escopa ao workspace ativo: o backfill usa creds Hotmart da DEMO (env) e casa por
  // hotmart_id — sem o filtro, varreria/atualizaria transações de outro tenant.
  const workspaceId = await getActiveWorkspaceId()

  let query = supabase
    .from('transacoes')
    .select('hotmart_id')
    .eq('workspace_id', workspaceId)
    .or('sck_slug.is.null,sck_slug.eq.')

  if (dataFiltro) {
    query = query.eq('data', dataFiltro)
  }

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows?.length) return NextResponse.json({ updated: 0, message: 'Nenhuma transação pendente' })

  const token = await getHotmartToken()
  if (!token) return NextResponse.json({ error: 'Falha ao obter token Hotmart' }, { status: 502 })

  let updated = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of rows) {
    try {
      const sckSlug = await fetchSckForTransaction(token, row.hotmart_id)
      if (!sckSlug) { skipped++; continue }

      const { error: upErr } = await supabase
        .from('transacoes')
        .update({ sck_slug: sckSlug })
        .eq('workspace_id', workspaceId)
        .eq('hotmart_id', row.hotmart_id)

      if (upErr) errors.push(`${row.hotmart_id}: ${upErr.message}`)
      else updated++
    } catch (e) {
      errors.push(`${row.hotmart_id}: ${String(e)}`)
    }
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  await audit({
    action: 'admin.backfill_sck',
    actorRole: 'admin',
    ip,
    userAgent: req.headers.get('user-agent') ?? null,
    resource: '/api/admin/backfill-sck',
    metadata: { updated, skipped, errors_count: errors.length, total: rows.length, dataFiltro: dataFiltro ?? null },
  })

  return NextResponse.json({ updated, skipped, errors, total: rows.length })
}
