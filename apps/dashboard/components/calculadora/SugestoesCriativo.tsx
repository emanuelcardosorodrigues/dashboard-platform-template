'use client'

import type { SugestaoCriativo, SugestoesPorMetrica } from '@/lib/calcSugestoes'

const METRICA_LABEL: Record<SugestoesPorMetrica['metrica'], string> = {
  ctr: 'CTR',
  convPag: 'Conversão de Página',
  ticket: 'Ticket Médio',
  roas: 'ROAS',
  lucroPorPv: 'Lucro por Visualização',
}

/**
 * Lista compacta de criativos que movem a métrica-objetivo ativa, um sinal por
 * métrica (tabela fixa em lib/calcSugestoes.ts) e SEMPRE lastreados no número real
 * (`evidencia`) que sustenta a sugestão. `semDado` é um estado explícito — nunca uma
 * lista fantasma quando a amostra da janela não sustenta nenhuma sugestão.
 */
export function SugestoesCriativo({ data }: { data: SugestoesPorMetrica }) {
  const metricaLabel = METRICA_LABEL[data.metrica]

  if (data.semDado) {
    return (
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-100">Sugestões de criativo · {metricaLabel}</p>
        <p className="mt-2 text-sm text-gray-400">
          Sem sugestão neste recorte — {data.motivoSemDado ?? 'amostra insuficiente na janela'}.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-100">Sugestões de criativo · {metricaLabel}</p>
        <span className="shrink-0 text-[11px] text-gray-500">sinal: {data.sinal}</span>
      </div>
      <ul className="space-y-2">
        {data.sugestoes.map((s, i) => (
          <SugestaoItem key={`${s.adId ?? s.criativo}-${i}`} rank={i + 1} sugestao={s} />
        ))}
      </ul>
    </div>
  )
}

function SugestaoItem({ rank, sugestao }: { rank: number; sugestao: SugestaoCriativo }) {
  return (
    <li className="rounded-lg border border-[#1F2937] bg-black/20 p-3">
      <p className="text-sm font-medium text-gray-100 truncate" title={sugestao.criativo}>
        {rank}. {sugestao.criativo}
      </p>
      <p className="mt-1 text-base font-bold text-emerald-400 tabular-nums">{sugestao.evidencia}</p>
      <p className="mt-1 text-xs text-gray-500 leading-snug">{sugestao.motivo}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sugestao.gancho ? <Chip>{sugestao.gancho}</Chip> : <Chip muted>SEM DADO · gancho</Chip>}
        {sugestao.formato ? <Chip>{sugestao.formato}</Chip> : <Chip muted>SEM DADO · formato</Chip>}
      </div>
    </li>
  )
}

function Chip({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? 'text-[10px] px-1.5 py-0.5 rounded-full bg-gray-800/60 text-gray-500 border border-gray-700/60'
          : 'text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
      }
    >
      {children}
    </span>
  )
}
