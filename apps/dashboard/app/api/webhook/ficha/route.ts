/**
 * POST /api/webhook/ficha — entrada AUTENTICADA pros Google Apps Scripts
 * (ficha de matrícula + programa aceleração/Águia) gravarem na `qualificacao`.
 *
 * Por que existe: os scripts escreviam direto no PostgREST com a anon key; o
 * RLS (deny-all) bloqueou e o pipeline morreu EM SILÊNCIO (última ficha
 * 2026-04-15). Esta rota valida um secret próprio e insere via service role.
 *
 * Path /api/webhook/* é público no middleware — a auth é o header
 * `x-ficha-secret` comparado (timing-safe) com env FICHA_WEBHOOK_SECRET.
 * Aceita 1 registro ou um array (importação histórica em lotes).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { revalidateTag } from 'next/cache'
import { log } from '@/lib/log'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

export const dynamic = 'force-dynamic'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

// Campos da qualificacao que os scripts podem gravar (whitelist — nada além disso passa).
const CAMPOS_PERMITIDOS = new Set([
  'email', 'nome', 'whatsapp', 'sexo', 'faixa_etaria', 'estado_civil', 'tem_filhos',
  'tipo_clinica', 'faturamento_declarado', 'num_cadeiras', 'tempo_odontologia',
  'especialidade', 'como_conheceu', 'maior_dificuldade', 'medos', 'objetivos',
  'o_que_falta', 'unica_coisa_incomoda', 'motivo_compra', 'o_que_impediu',
  'instagram', 'tentou_antes', 'funcionou', 'por_que_nao_funcionou',
  'emocao_fim_mes', 'valor_sonho_mensal', 'valor_sonho', 'quanto_sobra',
  'tem_socio', 'cpf_cnpj', 'tem_ficha', 'aluno_mentoria',
])

function secretOk(req: NextRequest): boolean {
  const secret = process.env.FICHA_WEBHOOK_SECRET
  const got = req.headers.get('x-ficha-secret') ?? ''
  if (!secret || !got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

function sanitize(raw: Record<string, unknown>): Record<string, unknown> | null {
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''
  if (!email || !email.includes('@') || email.length > 320) return null
  const out: Record<string, unknown> = { email }
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'email' || !CAMPOS_PERMITIDOS.has(k)) continue
    if (typeof v === 'boolean') out[k] = v
    else if (v == null) continue
    else out[k] = String(v).slice(0, 4000) // texto livre da ficha; corta abuso
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    if (!secretOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json()) as unknown
    const items = Array.isArray(body) ? body : [body]
    if (items.length > 200) return NextResponse.json({ error: 'máx 200 registros por lote' }, { status: 400 })

    // Ficha é fonte de lead específica do DEMO (cliente novo traz lead por compra via
    // Hotmart, já roteado). Tagueia os registros com o projeto DEMO (default).
    const wsId = await getActiveWorkspaceId()
    const records = items
      .map((r) => (r && typeof r === 'object' ? sanitize(r as Record<string, unknown>) : null))
      .filter((r): r is Record<string, unknown> => r !== null)
      .map((r) => ({ ...r, workspace_id: wsId }))

    if (records.length === 0) return NextResponse.json({ error: 'nenhum registro válido (email obrigatório)' }, { status: 400 })

    const { error } = await supa()
      .from('qualificacao')
      .upsert(records, { onConflict: 'workspace_id,email', ignoreDuplicates: false })
    if (error) {
      log.error('webhook/ficha upsert falhou', { msg: error.message, n: records.length })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    revalidateTag('sb-qualificacao', { expire: 0 })
    log.info('webhook/ficha ok', { n: records.length })
    return NextResponse.json({ ok: true, gravados: records.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('webhook/ficha falhou', { msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
