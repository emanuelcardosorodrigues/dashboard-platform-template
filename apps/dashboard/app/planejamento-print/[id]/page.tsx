export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { fetchAcaoVenda, fetchCenarios, fetchPlanejamentoConfig, ACAO_TIPO_LABEL, ACAO_STATUS_LABEL } from '@/lib/acoesVendas'
import { mergeImpostoConfig, computeCenarioReal, calcHorizonte, snapshotPrevisto, buildComparacao, calcLucroBrutoPlano } from '@/lib/planejamento'
import { computeDerivadoPorTipo } from '@/lib/funilEngine'
import { getSemaforoColorForFunil } from '@/lib/thresholds'

/** Investimento do estado (funil = investimento; legado = verbaTotal). */
function investimentoDoEstado(estado: unknown): number {
  const e = (estado ?? {}) as Record<string, unknown>
  const inv = typeof e.investimento === 'number' ? e.investimento : 0
  const vt = typeof e.verbaTotal === 'number' ? e.verbaTotal : 0
  return inv || vt
}
import { formatCurrency, formatNumber, formatRoas } from '@/lib/formatters'
import PrintButton from './PrintButton'

const SEM_HEX: Record<string, string> = { green: '#10B981', yellow: '#F59E0B', red: '#F43F5E' }

export default async function PrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const { id } = await params
  const { auto } = await searchParams
  const ws = await getActiveWorkspaceId()
  const acao = await fetchAcaoVenda(id, ws)
  if (!acao || !acao.is_planejamento) notFound()

  const [cenariosRaw, wsCfg, real] = await Promise.all([fetchCenarios(id, ws), fetchPlanejamentoConfig(ws), computeCenarioReal(acao, ws)])
  const impostos = mergeImpostoConfig(acao, wsCfg)
  const cenarios = [...cenariosRaw].sort((a, b) => a.ordem - b.ordem)
  const derivados = cenarios.map((c) => {
    const d = computeDerivadoPorTipo(acao.tipo, c.estado)
    const inv = investimentoDoEstado(c.estado)
    return { c, inv, d, l: calcLucroBrutoPlano(d.faturamentoTotal, inv, d.totalIngressos, impostos) }
  })
  const base = derivados.find((x) => x.c.ordem === 0) ?? derivados[0]
  let melhor = base
  for (const x of derivados) if (x.d.roas > melhor.d.roas) melhor = x
  const maxFat = Math.max(1, ...derivados.map((x) => x.d.faturamentoTotal))
  const maxRoas = Math.max(0.01, ...derivados.map((x) => x.d.roas))

  const previsto = base ? snapshotPrevisto(base.d, base.inv, impostos) : null
  const horizonte = calcHorizonte(acao)
  const linhas = previsto ? buildComparacao(previsto, real, impostos, horizonte, acao.comparacao_kpis ?? {}) : []

  // 4 alavancas do lucro (sobre o melhor cenário)
  const cpaSem = getSemaforoColorForFunil('cpa', melhor.d.cpaGlobal, undefined, melhor.d.ticketMedio)
  const alavancas = [
    { nome: 'Reduzir CPA', valor: formatCurrency(melhor.d.cpaGlobal), cor: SEM_HEX[cpaSem], rec: cpaSem === 'green' ? 'CPA saudável — manter criativos vencedores.' : 'Melhorar hook rate e conversão da página para baixar o CPA.' },
    { nome: 'Aumentar ticket', valor: formatCurrency(melhor.d.ticketMedio), cor: '#06B6D4', rec: 'Adicionar order bumps e escalonar lotes para subir o ticket médio.' },
    { nome: 'Aumentar LTV', valor: formatCurrency(melhor.d.produtoSubtotal), cor: '#A855F7', rec: 'Ascensão pós-evento (upsell/back-end) para elevar o LTV.' },
    { nome: 'Reduzir custos', valor: formatCurrency(melhor.l.impostoFaturamento + melhor.l.taxasHotmart), cor: '#F59E0B', rec: 'Revisar impostos/taxas e cortar desperdício operacional.' },
  ]

  const fmt = (key: string, v: number) => (key === 'roas' ? formatRoas(v) : key === 'vendas' ? formatNumber(v) : formatCurrency(v))

  return (
    <div style={{ background: '#0A0F1E', minHeight: '100vh', color: '#F9FAFB' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4; margin: 12mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .pp-card { background:#111827; border:1px solid #1F2937; border-radius:12px; padding:16px; }
        .pp-bar { height:10px; border-radius:6px; }
        table { border-collapse: collapse; width:100%; }
        .pp-th { font-size:9px; text-transform:uppercase; letter-spacing:.05em; color:#9CA3AF; text-align:right; padding:6px 8px; }
        .pp-td { font-size:12px; padding:7px 8px; text-align:right; font-variant-numeric: tabular-nums; border-top:1px solid #1F2937; }
      `}} />

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 24px' }} className="space-y-5">
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <PrintButton auto={auto === '1'} />
        </div>

        {/* Cabeçalho */}
        <div className="pp-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{acao.nome}</h1>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '4px 0 0' }}>
              {ACAO_TIPO_LABEL[acao.tipo]} · {ACAO_STATUS_LABEL[acao.status] ?? acao.status}{acao.sigla ? ` · ${acao.sigla}` : ''}
            </p>
            <p style={{ fontSize: 11, color: '#6B7280', margin: '2px 0 0' }}>{acao.data_inicio || '—'} → {acao.data_fim || '—'}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase' }}>Melhor cenário</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#22D3EE' }}>{melhor.c.nome}</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>ROAS {formatRoas(melhor.d.roas)}</div>
          </div>
        </div>

        {/* Metas do melhor cenário */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetaBox label="Investimento" value={formatCurrency(melhor.inv)} />
          <MetaBox label="Faturamento" value={formatCurrency(melhor.d.faturamentoTotal)} color="#34D399" />
          <MetaBox label="Lucro bruto" value={formatCurrency(melhor.l.lucroBruto)} color={melhor.l.lucroBruto >= 0 ? '#34D399' : '#FB7185'} />
          <MetaBox label="ROAS" value={formatRoas(melhor.d.roas)} color="#22D3EE" />
        </div>

        {/* Comparativo de cenários (barras CSS) */}
        <div className="pp-card">
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>Cenários — Faturamento & ROAS</h2>
          {derivados.map((x) => (
            <div key={x.c.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#D1D5DB', marginBottom: 3 }}>
                <span>{x.c.nome}{x.c.id === melhor.c.id ? ' ★' : ''}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(x.d.faturamentoTotal)} · {formatRoas(x.d.roas)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div className="pp-bar" style={{ width: `${(x.d.faturamentoTotal / maxFat) * 70}%`, background: '#10B981', minWidth: 2 }} />
                <div className="pp-bar" style={{ width: `${(x.d.roas / maxRoas) * 25}%`, background: '#06B6D4', minWidth: 2 }} />
              </div>
            </div>
          ))}
          <p style={{ fontSize: 9, color: '#6B7280', margin: '6px 0 0' }}>Barras: verde = faturamento, ciano = ROAS (relativo ao maior).</p>
        </div>

        {/* 4 alavancas do lucro */}
        <div className="pp-card">
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px' }}>4 Alavancas do Lucro</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {alavancas.map((a) => (
              <div key={a.nome} style={{ borderLeft: `3px solid ${a.cor}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 11, color: '#9CA3AF' }}>{a.nome}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: a.cor, fontVariantNumeric: 'tabular-nums' }}>{a.valor}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{a.rec}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Previsto × Realizado × Previsão */}
        {linhas.length > 0 && (
          <div className="pp-card">
            <h2 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>Previsto × Realizado × Previsão</h2>
            <p style={{ fontSize: 10, color: '#6B7280', margin: '0 0 10px' }}>
              {real.fonteInvestimento === 'sem_sigla' ? '⚠ Investimento real não casado (defina a sigla).' : `Investimento real casado por sigla (${real.matchMeta.ads} anúncios).`}
            </p>
            <table>
              <thead><tr>
                <th className="pp-th" style={{ textAlign: 'left' }}>Métrica</th><th className="pp-th">Previsto</th><th className="pp-th">Realizado</th><th className="pp-th">Previsão (fim)</th>
              </tr></thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.key}>
                    <td className="pp-td" style={{ textAlign: 'left', color: '#D1D5DB', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {l.semaforo && <span style={{ width: 6, height: 6, borderRadius: 99, background: SEM_HEX[l.semaforo] }} />}{l.label}
                    </td>
                    <td className="pp-td" style={{ color: '#E5E7EB' }}>{fmt(l.key, l.previsto)}</td>
                    <td className="pp-td" style={{ color: l.semaforo ? SEM_HEX[l.semaforo] : '#E5E7EB', fontWeight: 600 }}>{fmt(l.key, l.realizado)}</td>
                    <td className="pp-td" style={{ color: '#D1D5DB' }}>{fmt(l.key, l.previsao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 9, color: '#4B5563', textAlign: 'center' }}>Planejamento de Ação de Vendas · gerado pelo dashboard DEMO</p>
      </div>
    </div>
  )
}

function MetaBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="pp-card" style={{ padding: 12 }}>
      <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: color ?? '#F9FAFB', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}
