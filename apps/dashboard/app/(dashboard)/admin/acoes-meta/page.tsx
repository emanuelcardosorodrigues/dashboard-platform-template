export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { ArrowLeft, History, CheckCircle2, XCircle, Loader2, Pause, Play, TrendingUp, FileText, Bookmark } from 'lucide-react'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { fetchMetaAds } from '@/lib/supabase'

// ── Tipos da linha de auditoria ──────────────────────────────────────────────
interface AcaoLogRow {
  id: string
  ad_id: string
  tipo: string
  payload: Record<string, unknown> | null
  resultado: Record<string, unknown> | null
  status: 'running' | 'ok' | 'failed'
  error_message: string | null
  executado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function fetchAcoes(limit = 200): Promise<AcaoLogRow[]> {
  const sb = db()
  const { data } = await sb
    .from('criativo_acoes_log')
    .select('id,ad_id,tipo,payload,resultado,status,error_message,executado_por,iniciado_em,concluido_em')
    .order('iniciado_em', { ascending: false })
    .limit(limit) as { data: AcaoLogRow[] | null }
  return data ?? []
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' })
}

function brl(cents: unknown): string | null {
  const n = typeof cents === 'number' ? cents : Number(cents)
  if (!Number.isFinite(n)) return null
  return (n / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const TIPO_META: Record<string, { label: string; icon: typeof Pause; cls: string }> = {
  escalar:    { label: 'Orçamento', icon: TrendingUp, cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20' },
  pausar:     { label: 'Pausar',    icon: Pause,      cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  ativar:     { label: 'Ativar',    icon: Play,       cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  vault_save: { label: 'Nota',      icon: Bookmark,   cls: 'text-purple-300 bg-purple-500/10 border-purple-500/20' },
  mark_done:  { label: 'Concluído', icon: FileText,   cls: 'text-gray-300 bg-white/5 border-white/10' },
}

function TipoBadge({ tipo }: { tipo: string }) {
  const m = TIPO_META[tipo] ?? { label: tipo, icon: FileText, cls: 'text-gray-300 bg-white/5 border-white/10' }
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 ${m.cls}`}>
      <Icon size={11} /> {m.label}
    </span>
  )
}

function StatusBadge({ status }: { status: AcaoLogRow['status'] }) {
  if (status === 'ok') return <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={12} /> OK</span>
  if (status === 'failed') return <span className="inline-flex items-center gap-1 text-xs text-rose-400"><XCircle size={12} /> Falhou</span>
  return <span className="inline-flex items-center gap-1 text-xs text-amber-400"><Loader2 size={12} className="animate-spin" /> Rodando</span>
}

/**
 * "Quanto": pra escalar, mostra o orçamento antes→depois (do `resultado` quando ok —
 * fonte autoritativa do que foi gravado no Meta; senão do `payload` enviado).
 */
function Detalhe({ row }: { row: AcaoLogRow }) {
  if (row.tipo === 'escalar') {
    const r = row.resultado ?? {}
    const p = row.payload ?? {}
    const oldC = r.old_daily_budget_cents ?? p.expected_old_cents
    const newC = r.new_daily_budget_cents ?? p.new_daily_budget_cents
    const pct = r.budget_diff_pct
    const oldS = brl(oldC)
    const newS = brl(newC)
    if (newS) {
      return (
        <span className="tabular-nums text-gray-300">
          {oldS ? `${oldS} → ` : ''}<span className="text-white font-medium">{newS}</span>
          {typeof pct === 'number' && <span className={pct >= 0 ? 'text-emerald-400 ml-1.5' : 'text-rose-400 ml-1.5'}>{pct >= 0 ? '+' : ''}{pct}%</span>}
        </span>
      )
    }
    return <span className="text-gray-400">—</span>
  }
  if (row.tipo === 'pausar') return <span className="text-amber-300 text-xs">→ PAUSED</span>
  if (row.tipo === 'ativar') return <span className="text-emerald-300 text-xs">→ ACTIVE</span>
  return <span className="text-gray-400">—</span>
}

export default async function AcoesMetaPage() {
  // Defense-in-depth: o proxy já bloqueia /admin pra não-admin, mas este painel
  // expõe ações de DINHEIRO — re-checa a sessão no próprio handler.
  const sid = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sid ? await lookupSession(sid) : null
  if (!session || session.role !== 'admin') redirect('/login')

  const [acoes, metaRows] = await Promise.all([
    fetchAcoes(),
    fetchMetaAds().catch(() => []),
  ])

  // ad_id → nome legível (best-effort; reusa o fetch cacheado de meta_ads)
  const nomePorAd: Record<string, string> = {}
  for (const r of metaRows) {
    const id = r.ad_id
    if (id && !nomePorAd[id]) nomePorAd[id] = r.ad_name || r.criativo || id
  }

  const escalarOk = acoes.filter((a) => a.tipo === 'escalar' && a.status === 'ok').length
  const falhas = acoes.filter((a) => a.status === 'failed').length

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-500 hover:text-white transition-colors"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-lg font-semibold text-white flex items-center gap-2"><History size={17} className="text-cyan-400" /> Ações no Meta</h1>
            <p className="text-xs text-gray-500 mt-0.5">Auditoria de escrita — quem, quando, o quê e quanto. {acoes.length} registros · {escalarOk} orçamentos · {falhas} falhas.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0A0F1E] border-b border-[#1F2937] text-left">
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Quando</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Quem</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Ação</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Anúncio</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Quanto / Detalhe</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {acoes.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">Nenhuma ação registrada ainda.</td></tr>
                )}
                {acoes.map((a) => (
                  <tr key={a.id} className="border-b border-[#1F2937] last:border-b-0 hover:bg-white/[0.02] transition-colors align-top">
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtData(a.iniciado_em)}</td>
                    <td className="px-4 py-3 text-gray-300 text-xs">{a.executado_por ?? <span className="text-gray-400">sistema</span>}</td>
                    <td className="px-4 py-3"><TipoBadge tipo={a.tipo} /></td>
                    <td className="px-4 py-3">
                      <div className="max-w-64 truncate text-gray-300" title={nomePorAd[a.ad_id] ?? a.ad_id}>{nomePorAd[a.ad_id] ?? a.ad_id}</div>
                      <div className="text-[10px] text-gray-400 tabular-nums">{a.ad_id}</div>
                    </td>
                    <td className="px-4 py-3"><Detalhe row={a} /></td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.status} />
                      {a.error_message && <div className="text-[10px] text-rose-400/80 mt-1 max-w-72 truncate" title={a.error_message}>{a.error_message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-3">Mostrando as últimas {acoes.length} ações (mais recentes primeiro). O ator é sempre a sessão do servidor — não dá pra forjar pelo cliente.</p>
      </div>
    </div>
  )
}
