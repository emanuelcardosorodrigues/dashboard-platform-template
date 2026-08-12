'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import { ArrowLeft, Plus, Trash2, Save, Wallet } from 'lucide-react'
import { ACAO_TIPO_LABEL } from '@/lib/acoesVendas'
import { formatCurrency, formatPercent } from '@/lib/formatters'
import type { Consolidacao } from '@/lib/planejamento'

export default function CentroClient({ consolidacao, despesasFixas, pctVariavel }: {
  consolidacao: Consolidacao; despesasFixas: { nome: string; valor: number }[]; pctVariavel: number
}) {
  const router = useRouter()
  const c = consolidacao
  const lucroPos = c.lucroLiquido >= 0

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Link href="/planejamento" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-cyan-300"><ArrowLeft size={14} /> voltar aos planejamentos</Link>

      {/* Lucro líquido — destaque */}
      <div className={clsx('rounded-2xl border p-6 md:p-8', lucroPos ? 'bg-gradient-to-br from-emerald-500/10 to-[#111827] border-emerald-500/30' : 'bg-gradient-to-br from-rose-500/10 to-[#111827] border-rose-500/30')}>
        <div className="text-xs uppercase tracking-wider text-gray-400">Lucro Líquido da Operação (planejado)</div>
        <div className={clsx('text-4xl font-bold tabular-nums mt-1', lucroPos ? 'text-emerald-300' : 'text-rose-400')}>{formatCurrency(c.lucroLiquido)}</div>
        <div className="text-sm text-gray-400 mt-1">Margem líquida: <span className={lucroPos ? 'text-emerald-300' : 'text-rose-400'}>{formatPercent(c.lucroLiquidoPct * 100)}</span> do faturamento</div>
      </div>

      {/* KPIs da consolidação */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Box label="Faturamento Total" value={formatCurrency(c.faturamentoTotal)} accent="text-white" />
        <Box label="Soma das Margens de Contribuição" value={formatCurrency(c.somaMargens)} accent="text-emerald-300" />
        <Box label="Despesas Fixas" value={formatCurrency(c.despesasFixasTotal)} accent="text-amber-300" />
        <Box label={`Despesas Variáveis (${formatPercent(pctVariavel * 100)})`} value={formatCurrency(c.despesasVariaveis)} accent="text-amber-300" />
      </div>

      {/* Margem por funil */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 md:p-7">
        <h3 className="text-[15px] font-semibold text-white mb-4">Margem de Contribuição por Funil</h3>
        {c.planos.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum planejamento incluído na consolidação. Crie planejamentos (ou marque-os para incluir).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[10px] uppercase tracking-wider text-gray-500 text-left">
                <th className="py-2 pr-3">Funil</th><th className="py-2 px-3 text-right">Faturamento</th><th className="py-2 px-3 text-right">Investimento</th><th className="py-2 px-3 text-right">Taxas</th><th className="py-2 px-3 text-right">Imposto</th><th className="py-2 pl-3 text-right">Margem Contrib.</th>
              </tr></thead>
              <tbody>
                {c.planos.map((p) => (
                  <tr key={p.id} className="border-t border-[#1F2937]">
                    <td className="py-2.5 pr-3"><Link href={`/planejamento/${p.id}`} className="font-medium text-white hover:text-cyan-300">{p.nome}</Link><span className="text-[10px] text-gray-500 ml-2">{ACAO_TIPO_LABEL[p.tipo]}</span></td>
                    <td className="py-2.5 px-3 text-right text-gray-200 tabular-nums">{formatCurrency(p.faturamento)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{formatCurrency(p.investimento)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{formatCurrency(p.taxas)}</td>
                    <td className="py-2.5 px-3 text-right text-gray-400 tabular-nums">{formatCurrency(p.imposto)}</td>
                    <td className={clsx('py-2.5 pl-3 text-right tabular-nums font-medium', p.margemContribuicao >= 0 ? 'text-emerald-300' : 'text-rose-400')}>{formatCurrency(p.margemContribuicao)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#1F2937] font-semibold">
                  <td className="py-2.5 pr-3 text-white">Total</td>
                  <td className="py-2.5 px-3 text-right text-white tabular-nums">{formatCurrency(c.faturamentoTotal)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-300 tabular-nums">{formatCurrency(c.investimentoTotal)}</td>
                  <td colSpan={2}></td>
                  <td className="py-2.5 pl-3 text-right text-emerald-300 tabular-nums">{formatCurrency(c.somaMargens)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DespesasEditor despesasFixas={despesasFixas} pctVariavel={pctVariavel} onSaved={() => router.refresh()} />
    </div>
  )
}

function Box({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl px-4 py-3.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={clsx('text-lg font-semibold tabular-nums mt-1', accent ?? 'text-white')}>{value}</div>
    </div>
  )
}

function DespesasEditor({ despesasFixas, pctVariavel, onSaved }: { despesasFixas: { nome: string; valor: number }[]; pctVariavel: number; onSaved: () => void }) {
  const [itens, setItens] = useState(despesasFixas.length ? despesasFixas : [])
  const [pct, setPct] = useState(String(pctVariavel * 100))
  const [saving, setSaving] = useState(false)

  async function salvar() {
    setSaving(true)
    try {
      const res = await fetch('/api/planejamento/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ despesas_fixas: itens.filter((i) => i.nome.trim()), pct_variavel: (Number(pct) || 0) / 100 }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      onSaved()
    } catch (e) { alert('Erro ao salvar: ' + (e instanceof Error ? e.message : String(e))) } finally { setSaving(false) }
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6 md:p-7 space-y-5">
      <div className="flex items-center gap-2"><Wallet size={16} className="text-amber-300" /><h3 className="text-[15px] font-semibold text-white">Despesas da Operação</h3></div>

      <div>
        <div className="text-[11px] text-gray-500 mb-2">Despesas fixas mensais (Editor, ferramentas, contador…)</div>
        <div className="space-y-2">
          {itens.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className="col-span-7 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" placeholder="Nome da despesa" value={it.nome} onChange={(e) => setItens((p) => p.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} />
              <div className="col-span-4 flex items-center bg-[#0A0F1E] border border-[#1F2937] rounded-lg overflow-hidden focus-within:border-cyan-500/60">
                <span className="pl-2.5 text-xs text-gray-500">R$</span>
                <input type="number" className="w-full bg-transparent px-2 py-2 text-sm text-gray-200 tabular-nums focus:outline-none" value={it.valor} onChange={(e) => setItens((p) => p.map((x, j) => (j === i ? { ...x, valor: Number(e.target.value) || 0 } : x)))} />
              </div>
              <button onClick={() => setItens((p) => p.filter((_, j) => j !== i))} className="col-span-1 text-gray-600 hover:text-rose-400 cursor-pointer"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setItens((p) => [...p, { nome: '', valor: 0 }])} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 cursor-pointer"><Plus size={14} /> Adicionar despesa</button>
        </div>
      </div>

      <label className="flex flex-col gap-1 max-w-xs">
        <span className="text-[11px] text-gray-500">Despesa variável (% sobre faturamento — ex: sócio/comissão)</span>
        <div className="flex items-center bg-[#0A0F1E] border border-[#1F2937] rounded-lg overflow-hidden focus-within:border-cyan-500/60">
          <input type="number" className="w-full bg-transparent px-2.5 py-2 text-sm text-gray-200 tabular-nums focus:outline-none" value={pct} onChange={(e) => setPct(e.target.value)} />
          <span className="pr-2.5 text-xs text-gray-500">%</span>
        </div>
      </label>

      <div className="flex justify-end">
        <button onClick={salvar} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
          <Save size={15} /> {saving ? 'Salvando…' : 'Salvar despesas'}
        </button>
      </div>
    </div>
  )
}
