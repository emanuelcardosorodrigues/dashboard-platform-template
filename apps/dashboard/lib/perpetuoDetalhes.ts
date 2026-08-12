/**
 * Detalhes do funil pro modal do nó (Perpétuo / B-P4). Deriva 6 painéis a partir
 * das transações JÁ filtradas por funil+período (as mesmas do /campanhas) + do
 * PeriodSummary — sem novos fetches. "Por pesquisa" (join survey) fica de fora
 * nesta v1 (precisa da qualificacao; follow-up).
 */
import type { SbTransacao, SbQualificacao } from '@/lib/supabase'
import { aggregateByOrigem } from '@/lib/origem'
import type { PeriodSummary } from '@/lib/periodSummary'
import { computeTempoCompra, type TempoCompra, type QualComData } from '@/lib/tempoCompra'

export interface PerpetuoDetalhes {
  serie: { date: string; faturamento: number; vendas: number }[]
  origem: { label: string; vendas: number; faturamento: number }[]
  pagina: { slug: string; vendas: number; faturamento: number }[]
  hora: { hora: number; vendas: number }[]
  diaSemana: { dia: number; vendas: number }[]
  esteira: { etapa: string; valor: number }[]
  /** compradores únicos cruzados com a ficha, por resposta de pesquisa */
  pesquisa: { campo: string; label: string; itens: { resposta: string; vendas: number }[] }[]
  /** tempo médio lead→compra em dias (mediana + n), cruzando ficha×transação por email */
  tempoCompra: TempoCompra
}

export function buildPerpetuoDetalhes(
  transacoes: SbTransacao[],
  summary: PeriodSummary,
  qualMap: Map<string, SbQualificacao>,
): PerpetuoDetalhes {
  // Série diária (Faturamento × Vendas)
  const serieMap = new Map<string, { faturamento: number; vendas: number }>()
  for (const t of transacoes) {
    const d = t.data || ''
    if (!d) continue
    const e = serieMap.get(d) ?? { faturamento: 0, vendas: 0 }
    e.faturamento += t.valor_bruto || 0
    e.vendas += 1
    serieMap.set(d, e)
  }
  const serie = [...serieMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, faturamento: v.faturamento, vendas: v.vendas }))

  // Por origem (pago / orgânico / whatsapp / direto)
  const origem = aggregateByOrigem(transacoes).map((o) => ({
    label: o.label,
    vendas: o.vendas,
    faturamento: o.faturamentoBruto,
  }))

  // Por página (sck_slug), top 12 por vendas
  const pagMap = new Map<string, { vendas: number; faturamento: number }>()
  for (const t of transacoes) {
    const slug = t.sck_slug || '(sem página)'
    const e = pagMap.get(slug) ?? { vendas: 0, faturamento: 0 }
    e.vendas += 1
    e.faturamento += t.valor_bruto || 0
    pagMap.set(slug, e)
  }
  const pagina = [...pagMap.entries()]
    .map(([slug, v]) => ({ slug, vendas: v.vendas, faturamento: v.faturamento }))
    .sort((a, b) => b.vendas - a.vendas)
    .slice(0, 12)

  // Por hora do dia (0–23) — usa hora_compra "HH:MM:SS"
  const hora = Array.from({ length: 24 }, (_, h) => ({ hora: h, vendas: 0 }))
  for (const t of transacoes) {
    const h = Number((t.hora_compra || '').slice(0, 2))
    if (Number.isFinite(h) && h >= 0 && h < 24) hora[h].vendas += 1
  }

  // Por dia da semana (0=Dom … 6=Sáb)
  const diaSemana = Array.from({ length: 7 }, (_, d) => ({ dia: d, vendas: 0 }))
  for (const t of transacoes) {
    if (!t.data) continue
    const dow = new Date(t.data + 'T12:00:00Z').getUTCDay()
    if (dow >= 0 && dow < 7) diaSemana[dow].vendas += 1
  }

  // Etapas da esteira (do summary)
  const esteira = [
    { etapa: 'Impressões', valor: summary.impressoes },
    { etapa: 'Cliques', valor: summary.cliques },
    { etapa: 'Visitas', valor: summary.landingViews },
    { etapa: 'Checkouts', valor: summary.checkouts },
    { etapa: 'Vendas', valor: summary.vendasFront },
  ]

  // Por pesquisa: compradores ÚNICOS (por email) cruzados com a ficha de qualificação
  const seen = new Set<string>()
  const buyers: SbQualificacao[] = []
  for (const t of transacoes) {
    const email = (t.email || '').toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    const q = qualMap.get(email)
    if (q) buyers.push(q)
  }
  const CAMPOS: { campo: keyof SbQualificacao; label: string }[] = [
    { campo: 'faturamento_declarado', label: 'Faturamento declarado' },
    { campo: 'especialidade', label: 'Especialidade' },
    { campo: 'tempo_odontologia', label: 'Tempo de odontologia' },
    { campo: 'como_conheceu', label: 'Como conheceu' },
    { campo: 'maior_dificuldade', label: 'Maior dificuldade' },
  ]
  const pesquisa = CAMPOS.map((f) => {
    const counts = new Map<string, number>()
    for (const b of buyers) {
      const raw = b[f.campo]
      const val = (typeof raw === 'string' ? raw.trim() : '') || '(sem resposta)'
      counts.set(val, (counts.get(val) ?? 0) + 1)
    }
    const itens = [...counts.entries()]
      .map(([resposta, vendas]) => ({ resposta, vendas }))
      .sort((a, b) => b.vendas - a.vendas)
      .slice(0, 10)
    return { campo: String(f.campo), label: f.label, itens }
  }).filter((f) => f.itens.length > 0)

  // Tempo médio lead→compra (dias) — mesma junção por email da "pesquisa" acima.
  const tempoCompra = computeTempoCompra(transacoes, qualMap as Map<string, QualComData>)

  return { serie, origem, pagina, hora, diaSemana, esteira, pesquisa, tempoCompra }
}
