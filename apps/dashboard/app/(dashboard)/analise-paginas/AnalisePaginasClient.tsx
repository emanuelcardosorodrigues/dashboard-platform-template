'use client'

import { useState } from 'react'
import { ChevronDown, AlertTriangle } from 'lucide-react'
import FilterToggle from '@/components/filters/FilterToggle'
import KpiCard from '@/components/cards/KpiCard'
import { SEMAFORO_CSS } from '@/lib/thresholds'
import { formatCurrency, formatCurrencyCompact, formatNumber } from '@/lib/formatters'
import { paginaCores, type PageAnalysisResult, type PaginaRow, type PaginaCor, type Gargalo } from '@/lib/paginas'

const GARGALO_LABEL: Record<Gargalo, string> = {
  engajamento: 'Engajamento', copy: 'Copy / Página', checkout: 'Checkout',
  congruencia: 'Congruência', ok: 'Saudável', insuficiente: 'Sem dados',
}

function corClass(c: PaginaCor): string {
  return c === 'gray' ? 'text-gray-500' : SEMAFORO_CSS[c]
}
function pct(v: number | null, dec = 1): string {
  return v == null ? '—' : `${v.toFixed(dec).replace('.', ',')}%`
}

export default function AnalisePaginasClient({
  result, janela, ga4Ok, expOk = true, uidOk = true, clarOk = true,
}: {
  result: PageAnalysisResult
  janela: { de: string; ate: string; funil: string }
  ga4Ok: boolean
  /** Falso quando a busca de experimentos/UIDs A/B/Clarity falhou (allSettled rejeitado) —
   *  distinto de "não há dados": aqui a fonte nem respondeu, então a tabela usa fallback silencioso. */
  expOk?: boolean
  uidOk?: boolean
  clarOk?: boolean
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const { rows, totals, uidSource } = result

  return (
    <div className="space-y-5">
      <FilterToggle prefix="p" />

      {/* Banner de janela / cobertura / fonte */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="tabular-nums">Período: {janela.de} → {janela.ate}</span>
        <span>· {totals.paginas} páginas ({totals.comUid} com UID A/B · {totals.comClarity} com Clarity)</span>
        <span>· impressão A/B: <span className={uidSource === 'beacon' ? 'text-emerald-400' : uidSource === 'redirect' ? 'text-amber-400' : 'text-gray-400'}>{uidSource}</span></span>
        {!ga4Ok && <span className="text-amber-400">· GA4 indisponível (conversão usa só UIDs A/B)</span>}
        {!expOk && <span className="text-amber-400">· Experimentos A/B indisponíveis no momento</span>}
        {!uidOk && <span className="text-amber-400">· UIDs A/B indisponíveis (passagem/conversão usa só GA4)</span>}
        {!clarOk && <span className="text-amber-400">· Clarity indisponível no momento (sem scroll/engajamento)</span>}
        {uidSource === 'redirect' && (
          <span className="flex items-center gap-1 text-amber-400"><AlertTriangle size={11} /> impressão no redirect infla o denominador vs o connect rate do Meta</span>
        )}
      </div>

      {/* Cards-resumo */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Páginas" value={String(totals.paginas)} />
        <KpiCard label="Sessões" value={formatNumber(totals.sessoes, 0)} />
        <KpiCard label="Vendas front" value={formatNumber(totals.vendasFront, 0)} />
        <KpiCard label="Receita líquida" value={formatCurrencyCompact(totals.receitaLiquida)} />
        <KpiCard label="Com UID A/B" value={`${totals.comUid}/${totals.paginas}`} />
        <KpiCard label="Com Clarity" value={`${totals.comClarity}/${totals.paginas}`} />
      </div>

      {/* Tabela */}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">Nenhuma página com dados no período/funil selecionado.</p>
      ) : (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1F2937] text-[11px] uppercase tracking-wider text-gray-500">
                  <th scope="col" className="text-left py-2.5 px-4 font-semibold">Página</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">Base</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold" title="Visitantes únicos que chegaram ao checkout ÷ visitantes únicos da página (interseção de UIDs)">Passagem</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold" title="Vendas front ÷ base (UIDs únicos ou sessões GA4)">Conv→Front</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold" title="Vendas front ÷ quem chegou ao checkout">CVR Checkout</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">Vendas</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">Ticket</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">Receita líq</th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">Scroll</th>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">Diagnóstico</th>
                  <th scope="col" className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Linha key={r.slug} r={r} aberto={aberto === r.slug} onToggle={() => setAberto(aberto === r.slug ? null : r.slug)} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[10px] text-gray-400 border-t border-[#1F2937]">
            Passagem = interseção de UIDs (impressões A/B) · Conv→Front = vendas Hotmart (sck) ÷ base (UID/GA4) · Ticket = faturamento ÷ vendas front · Scroll/UX = Clarity. Slug cruza GA4 pagePath ↔ Hotmart sck ↔ Clarity url.
          </p>
        </div>
      )}
    </div>
  )
}

function Linha({ r, aberto, onToggle }: { r: PaginaRow; aberto: boolean; onToggle: () => void }) {
  const base = r.temUid ? r.uidsPagina : r.sessionsGa4
  return (
    <>
      <tr className="border-b border-[#1F2937]/50 hover:bg-[#1F2937]/30 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="py-2.5 px-4">
          <span className="font-mono text-[12px] text-gray-200">{r.slug}</span>
          {r.funil && <span className="ml-2 text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{r.funil}</span>}
          {r.soHotmart && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400" title="Sem GA4 nem UID — só vendas Hotmart">só Hotmart</span>}
        </td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-300">
          {base > 0 ? formatNumber(base, 0) : '—'}
          <span className="ml-1 text-[9px] text-gray-500">{r.temUid ? 'UID' : r.temGa4 ? 'GA4' : ''}</span>
        </td>
        <td
          className={`py-2.5 px-3 text-right tabular-nums font-medium ${corClass(paginaCores.corPassagem(r.passagemCheckoutPct))}`}
          title={
            r.passagemFonte === 'hits'
              ? 'Passagem aproximada (~GA): clicantes distintos (client id do GA) ÷ usuários GA4. O cid reseta (Safari/ITP, outro aparelho) — tende a subestimar. Cobre todo o tráfego.'
              : r.passagemFonte === 'uid'
                ? 'Passagem EXATA: dos uids que viram a página, quantos clicaram pro checkout. O GTM server-side lê o cookie uid (HttpOnly) — mesma identidade das views. Cobre só o tráfego roteado pelo /r/.'
                : r.passagemCheckoutPct == null && r.temUid && !r.temSinalCheckout
                  ? 'Passagem imensurável: sem teste de checkout vinculado E sem cliques da tag GTM. Não é 0% — é falta de instrumentação.'
                  : undefined
          }
        >
          {pct(r.passagemCheckoutPct)}
          {r.passagemFonte === 'hits' && (
            <span className="ml-1 text-[9px] text-amber-400/70" title="estimativa via client id do GA (não é uid)">~GA</span>
          )}
          {r.passagemFonte === 'uid' && (
            <span className="ml-1 text-[9px] text-emerald-400/70" title="exato: interseção de uid (GTM server-side lê o cookie HttpOnly)">uid</span>
          )}
          {r.passagemCheckoutPct == null && r.temUid && !r.temSinalCheckout && (
            <span className="ml-1 text-[9px] text-gray-500" title="sem teste de checkout vinculado nem cliques GTM">s/ teste</span>
          )}
        </td>
        <td className={`py-2.5 px-3 text-right tabular-nums font-medium ${corClass(paginaCores.corConv(r.convPaginaFrontPct))}`}>{pct(r.convPaginaFrontPct, 2)}</td>
        <td className={`py-2.5 px-3 text-right tabular-nums ${corClass(paginaCores.corCheckout(r.cvrCheckoutPct))}`}>{pct(r.cvrCheckoutPct)}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-300">{formatNumber(r.frontSales, 0)}</td>
        <td className="py-2.5 px-3 text-right tabular-nums text-gray-300">{r.ticketMedio == null ? '—' : formatCurrency(r.ticketMedio)}</td>
        <td className="py-2.5 px-3 text-right tabular-nums font-medium text-white">{formatCurrencyCompact(r.receitaLiquida)}</td>
        <td className={`py-2.5 px-3 text-right tabular-nums ${corClass(paginaCores.corScroll(r.scrollDepthPct))}`}>{r.scrollDepthPct == null ? '—' : `${r.scrollDepthPct.toFixed(0)}%`}</td>
        <td className="py-2.5 px-3">
          <span className={`inline-flex items-center gap-1.5 text-[11px] ${corClass(r.diag.cor)}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            {GARGALO_LABEL[r.diag.gargalo]}
          </span>
        </td>
        <td className="py-2.5 pr-3 text-gray-500"><ChevronDown size={14} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} /></td>
      </tr>
      {aberto && (
        <tr className="bg-[#0B1220] border-b border-[#1F2937]">
          <td colSpan={11} className="px-4 py-3">
            <div className="space-y-2 text-[12px]">
              <p className={`font-medium ${corClass(r.diag.cor)}`}>⚑ {r.diag.texto}</p>
              <p className="text-gray-400"><span className="text-gray-500">Ação:</span> {r.diag.acao}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-gray-500 pt-1">
                <span>UIDs página: <span className="text-gray-300">{formatNumber(r.uidsPagina, 0)}</span></span>
                <span>Chegaram ao checkout: <span className="text-gray-300">{formatNumber(r.checkoutInter, 0)}</span></span>
                {r.hitClicantes > 0 && <span>Cliques checkout (GTM): <span className="text-gray-300">{formatNumber(r.hitClicantes, 0)}</span></span>}
                <span>Sessões GA4: <span className="text-gray-300">{r.sessionsGa4 > 0 ? formatNumber(r.sessionsGa4, 0) : '—'}</span></span>
                <span>Clarity: <span className="text-gray-300">{r.temClarity ? `${formatNumber(r.claritySessions ?? 0, 0)} sess · scroll ${r.scrollDepthPct?.toFixed(0) ?? '—'}% · ${formatNumber(r.engagementSec ?? 0, 0)}s · ${formatNumber(r.rageClicks ?? 0, 0)} rage` : 'sem dados'}</span></span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
