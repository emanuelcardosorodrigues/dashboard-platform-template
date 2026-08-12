'use client'

import { AlertTriangle } from 'lucide-react'

interface Props {
  total: number
  quarantined: number
  uniqueUaCount: number
  topUas: { ua: string; count: number; countries: string; lastSeen: string }[]
  rows: Array<{
    ua: string; ip: string; cf_bot_score: number | null
    cf_country: string; accept_language: string; referer: string; captured_at: string
  }>
  /** true quando o fetch a /api/bots falhou (rejeitou ou respondeu não-ok) — nesse
   *  caso os dados abaixo NÃO significam "sem registros", significam "não deu pra saber". */
  fetchFailed?: boolean
}

function scoreColor(score: number | null) {
  if (score === null) return 'text-gray-500'
  if (score <= 30) return 'text-red-400'
  if (score <= 60) return 'text-yellow-400'
  return 'text-emerald-400'
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SaudeTrafegoClient({ total, quarantined, uniqueUaCount, topUas, rows, fetchFailed }: Props) {
  return (
    <div className="space-y-6">
      {fetchFailed && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-xs text-amber-300 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          Falha ao consultar /api/bots — os dados abaixo estão vazios porque a busca não deu certo (não porque não há registros). Verifique CLOUDFLARE_API_TOKEN/ACCOUNT_ID/D1_DATABASE_ID e tente recarregar.
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Registros capturados</p>
          <p className="text-2xl font-bold text-white mt-1">{total}</p>
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">UAs únicos</p>
          <p className="text-2xl font-bold text-white mt-1">{uniqueUaCount}</p>
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">UIDs quarentenados</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{quarantined}</p>
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">Score médio Cloudflare</p>
          <p className="text-2xl font-bold text-white mt-1">
            {rows.length > 0
              ? Math.round(rows.filter(r => r.cf_bot_score !== null).reduce((s, r) => s + (r.cf_bot_score ?? 0), 0) / Math.max(rows.filter(r => r.cf_bot_score !== null).length, 1))
              : '—'}
          </p>
        </div>
      </div>

      {/* Top UAs */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1F2937]">
          <h3 className="text-sm font-medium text-gray-300">Top User-Agents</h3>
          <p className="text-xs text-gray-400 mt-0.5">Todo tráfego em /r/probe é bot — nenhum humano conhece a URL</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] text-gray-500">
                <th className="px-4 py-2 text-left font-medium">User-Agent</th>
                <th className="px-4 py-2 text-right font-medium">Hits</th>
                <th className="px-4 py-2 text-left font-medium">Países</th>
                <th className="px-4 py-2 text-right font-medium">Último</th>
              </tr>
            </thead>
            <tbody>
              {topUas.map((u, i) => (
                <tr key={i} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30">
                  <td className="px-4 py-2 font-mono text-[10px] text-gray-400 max-w-xs truncate" title={u.ua}>{u.ua || '(sem UA)'}</td>
                  <td className="px-4 py-2 text-right text-white font-medium">{u.count}</td>
                  <td className="px-4 py-2 text-gray-400">{u.countries || '—'}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{fmtDate(u.lastSeen)}</td>
                </tr>
              ))}
              {topUas.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  {fetchFailed
                    ? 'Não foi possível consultar /api/bots — veja o aviso acima.'
                    : 'Nenhum registro no período. Crie um anúncio apontando para example.com/r/probe.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log recente */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1F2937]">
          <h3 className="text-sm font-medium text-gray-300">Log recente (50 últimos)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Data</th>
                <th className="px-4 py-2 text-left font-medium">País</th>
                <th className="px-4 py-2 text-right font-medium">CF Score</th>
                <th className="px-4 py-2 text-left font-medium">Referer</th>
                <th className="px-4 py-2 text-left font-medium">User-Agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.captured_at)}</td>
                  <td className="px-4 py-2 text-gray-400">{r.cf_country || '—'}</td>
                  <td className={`px-4 py-2 text-right font-mono font-medium ${scoreColor(r.cf_bot_score)}`}>
                    {r.cf_bot_score ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate font-mono text-[10px]" title={r.referer}>{r.referer || '—'}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate font-mono text-[10px]" title={r.ua}>{r.ua || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {fetchFailed ? 'Não foi possível consultar /api/bots — veja o aviso acima.' : 'Sem registros ainda.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
