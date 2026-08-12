/**
 * Cron: quarentena de UIDs suspeitos (Etapa 0D)
 *
 * UIDs com >3 impressões no mesmo experimento em <60s são adicionados
 * à tabela bot_uids do Supabase para filtrar analytics.
 *
 * Rodar via Vercel Cron ou manualmente: GET /api/cron/quarantine-bots
 * com header Authorization: Bearer $CRON_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const secret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Identifica UIDs que geraram >3 impressões no mesmo experimento em <60s
  const { data: suspects, error } = await supabase.rpc('find_rate_suspicious_uids')

  if (error) {
    // Função não existe ainda — retornar instrução de criação
    return NextResponse.json({
      error: 'RPC find_rate_suspicious_uids não encontrada. Execute a migration SQL.',
      sql: MIGRATION_SQL,
    }, { status: 500 })
  }

  if (!suspects || suspects.length === 0) {
    return NextResponse.json({ quarantined: 0, message: 'Nenhum UID suspeito detectado.' })
  }

  // Fase 3: inserir como SUSPECT, não confirmed. UI permite revisão humana
  // antes de excluir das analytics. Score 40 = Worker hit local (rate burst).
  const rows = suspects.map((s: { uid: string; ip_fp: string }) => ({
    uid: s.uid,
    ip_fp: s.ip_fp,
    source: 'rate_suspicious',
    score: 40,
    signals: { worker_rate_burst: true },
    status: 'suspect',
  }))

  const { error: insertError } = await supabase
    .from('bot_uids')
    .upsert(rows, { onConflict: 'uid', ignoreDuplicates: true })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ quarantined: rows.length, uids: suspects.map((s: { uid: string }) => s.uid) })
}

const MIGRATION_SQL = `
-- Tabela de UIDs suspeitos (bots que escaparam da detecção em tempo real)
CREATE TABLE IF NOT EXISTS bot_uids (
  uid       text PRIMARY KEY,
  ip_fp     text,
  source    text NOT NULL DEFAULT 'rate_suspicious',
  created_at timestamptz DEFAULT now()
);

-- Função RPC: detecta UIDs com burst >3 impressões no mesmo exp em 60s
CREATE OR REPLACE FUNCTION find_rate_suspicious_uids()
RETURNS TABLE(uid text, ip_fp text) AS $$
  SELECT DISTINCT uid, ip_fp
  FROM impressions
  WHERE timestamp > now() - interval '24 hours'
  GROUP BY experiment_id, uid, ip_fp
  HAVING COUNT(*) > 3
    AND MAX(timestamp) - MIN(timestamp) < interval '60 seconds'
$$ LANGUAGE sql STABLE;
`
