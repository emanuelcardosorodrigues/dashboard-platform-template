/**
 * Exporta um planejamento para .xlsx (SheetJS) — botão "Exportar planilha".
 * Funciona para qualquer motor (lançamento/LaunchSim ou funil): consome o
 * CenarioDerivado + o estado bruto de cada cenário. Roda no cliente (download direto).
 */
import * as XLSX from 'xlsx'
import type { CenarioDerivado } from './acoesVendas'

export interface CenarioExport {
  nome: string
  estado: Record<string, unknown>
  derivado: CenarioDerivado
  lucro: number
  investimento: number
}

/** Achata um objeto aninhado em "chave.sub" → valor (arrays viram JSON). */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key))
    else if (Array.isArray(v)) out[key] = JSON.stringify(v)
    else out[key] = (typeof v === 'number' || typeof v === 'string') ? v : String(v)
  }
  return out
}

const slug = (s: string) => (s || 'planejamento').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export function exportPlanejamentoXlsx(nome: string, cenarios: CenarioExport[]): void {
  const wb = XLSX.utils.book_new()

  // Resumo — uma linha por cenário
  const resumo = cenarios.map((c) => ({
    'Cenário': c.nome,
    'Investimento': round(c.investimento),
    'CPA': round(c.derivado.cpa),
    'Vendas/Ingressos': round(c.derivado.totalIngressos),
    'Ticket Médio': round(c.derivado.ticketMedio),
    'Fat. Evento/Front': round(c.derivado.eventoSubtotal),
    'Fat. Produto': round(c.derivado.produtoSubtotal),
    'Faturamento Total': round(c.derivado.faturamentoTotal),
    'Lucro Bruto': round(c.lucro),
    'ROAS': round(c.derivado.roas, 2),
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo')

  // Configuração — base (primeiro cenário) achatado
  const base = cenarios[0]
  if (base) {
    const cfg = Object.entries(flatten(base.estado)).map(([Campo, Valor]) => ({ Campo, Valor }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cfg), 'Configuração')
  }

  // Lotes (se houver) — do base
  const lotes = base?.derivado.lotes ?? []
  if (lotes.length) {
    const rows = lotes.map((l) => ({ Lote: l.nome, Ingressos: round(l.ingressos), Faturamento: round(l.faturamento) }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Lotes')
  }

  // Produtos/OBs (se houver) — do base
  const obs = base?.derivado.eventoOBs ?? []
  if (obs.length) {
    const rows = obs.map((o) => ({ Produto: o.nome, Vendas: round(o.vendas), Faturamento: round(o.faturamento) }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Produtos')
  }

  XLSX.writeFile(wb, `${slug(nome)}.xlsx`)
}

function round(n: number, d = 2): number {
  if (!Number.isFinite(n)) return 0
  const f = 10 ** d
  return Math.round(n * f) / f
}
