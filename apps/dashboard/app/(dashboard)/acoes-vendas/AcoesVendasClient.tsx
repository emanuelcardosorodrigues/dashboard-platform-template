'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clsx } from 'clsx'
import { Plus, Trash2, ChevronRight, X } from 'lucide-react'
import { ACAO_TIPO_LABEL, KPI_OPTIONS, type AcaoTipo, type SbAcaoVenda } from '@/lib/acoesVendas'
import { formatNumber, formatCurrencyCompact } from '@/lib/formatters'

export type ResumoMap = Record<string, { vendas: number; faturamento: number; receita: number; metaPct: number | null; metaLabel: string | null }>

const TIPO_ORDER: AcaoTipo[] = ['lancamento_pago', 'lancamento_gratis', 'low_ticket', 'perpetuo_vsl']
const STATUS_BG: Record<string, string> = {
  ativo: 'bg-emerald-500/15 text-emerald-300', rascunho: 'bg-slate-500/15 text-slate-300', encerrado: 'bg-zinc-700/40 text-zinc-400',
}
const ROLES: { key: 'produtos_front' | 'produtos_ob' | 'produtos_upsell' | 'produtos_downsell'; label: string }[] = [
  { key: 'produtos_front', label: 'Front-end' },
  { key: 'produtos_ob', label: 'Order Bumps' },
  { key: 'produtos_upsell', label: 'Upsells' },
  { key: 'produtos_downsell', label: 'Downsells' },
]

export default function AcoesVendasClient({ acoes, produtos, resumo }: { acoes: SbAcaoVenda[]; produtos: string[]; resumo: ResumoMap }) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">{acoes.length} {acoes.length === 1 ? 'ação cadastrada' : 'ações cadastradas'}</p>
        <button onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
          {showForm ? <X size={16} /> : <Plus size={16} />} {showForm ? 'Fechar' : 'Nova ação'}
        </button>
      </div>

      {showForm && <NovaAcaoForm produtos={produtos} onDone={() => { setShowForm(false); router.refresh() }} />}

      {acoes.length === 0 ? (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-10 text-center">
          <p className="text-sm text-gray-400">Nenhuma ação de vendas cadastrada.</p>
          <p className="text-xs text-gray-400 mt-1">Clique em &quot;Nova ação&quot; para criar a primeira (ex: Lançamento Pago Semana X).</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...acoes].sort((a, b) => TIPO_ORDER.indexOf(a.tipo) - TIPO_ORDER.indexOf(b.tipo)).map((a) => {
            const r = resumo[a.id]
            return (
              <Link key={a.id} href={`/acoes-vendas/${a.id}`}
                className="group bg-[#111827] border border-[#1F2937] rounded-xl p-4 hover:border-cyan-500/40 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-cyan-300">{a.nome}</h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">{ACAO_TIPO_LABEL[a.tipo]}</p>
                  </div>
                  <span className={clsx('text-[10px] px-1.5 py-0.5 rounded shrink-0', STATUS_BG[a.status] ?? STATUS_BG.rascunho)}>{a.status}</span>
                </div>
                {a.produtos_front.length + a.produtos_ob.length + a.produtos_upsell.length + a.produtos_downsell.length === 0 && (
                  <p className="text-[10px] text-amber-400 mb-2" title="Sem produtos cadastrados, a ação soma todas as vendas do período — inclusive de outros funis.">⚠ sem produtos — soma tudo do período</p>
                )}
                <p className="text-[11px] text-gray-500 mb-3 tabular-nums">
                  {a.data_inicio || '—'} → {a.data_fim || '—'}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Vendas" value={formatNumber(r?.vendas ?? 0, 0)} />
                  <Mini label="Faturamento" value={formatCurrencyCompact(r?.faturamento ?? 0)} />
                  <Mini label="Receita líq" value={formatCurrencyCompact(r?.receita ?? 0)} />
                </div>
                {r?.metaPct != null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                      <span>{r.metaLabel}</span><span className="tabular-nums">{r.metaPct.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#1F2937] overflow-hidden">
                      <div className="h-full bg-cyan-500" style={{ width: `${Math.min(r.metaPct, 100)}%` }} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end mt-3 text-[11px] text-gray-400 group-hover:text-cyan-400">
                  ver painel <ChevronRight size={13} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-white tabular-nums">{value}</div>
    </div>
  )
}

function NovaAcaoForm({ produtos, onDone }: { produtos: string[]; onDone: () => void }) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<AcaoTipo>('lancamento_pago')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [roles, setRoles] = useState<Record<string, Set<string>>>({ produtos_front: new Set(), produtos_ob: new Set(), produtos_upsell: new Set(), produtos_downsell: new Set() })
  const [metas, setMetas] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  function toggle(roleKey: string, produto: string) {
    setRoles((prev) => {
      const next: Record<string, Set<string>> = {}
      for (const r of ROLES) next[r.key] = new Set(prev[r.key])
      // um produto fica em no máximo um papel
      for (const r of ROLES) next[r.key].delete(produto)
      if (!prev[roleKey].has(produto)) next[roleKey].add(produto)
      return next
    })
  }

  async function salvar() {
    if (!nome.trim()) { alert('Dê um nome à ação'); return }
    setSaving(true)
    try {
      const metasNum: Record<string, number> = {}
      for (const [k, v] of Object.entries(metas)) { const n = Number(v); if (n > 0) metasNum[k] = n }
      const res = await fetch('/api/acoes-vendas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nome.trim(), tipo, data_inicio: dataInicio || null, data_fim: dataFim || null,
          produtos_front: [...roles.produtos_front], produtos_ob: [...roles.produtos_ob],
          produtos_upsell: [...roles.produtos_upsell], produtos_downsell: [...roles.produtos_downsell],
          metas: metasNum,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
      onDone()
    } catch (e) { alert('Erro ao salvar: ' + (e instanceof Error ? e.message : String(e))) } finally { setSaving(false) }
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Nome da ação</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Lançamento Pago Semana 24"
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as AcaoTipo)}
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60 cursor-pointer">
            {(Object.keys(ACAO_TIPO_LABEL) as AcaoTipo[]).map((t) => <option key={t} value={t}>{ACAO_TIPO_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Início (opcional)</span>
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Fim (opcional)</span>
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
            className="bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60" />
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] text-gray-500">Produtos da ação (clique pra marcar o papel; cada produto fica em um papel só). Sem marcar nenhum, a ação usa todos os produtos no período.</p>
        {ROLES.map((role) => (
          <div key={role.key}>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">{role.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {produtos.map((p) => {
                const on = roles[role.key].has(p)
                return (
                  <button key={p} onClick={() => toggle(role.key, p)}
                    className={clsx('text-[11px] px-2 py-1 rounded-md border transition-colors cursor-pointer',
                      on ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-[#1F2937] text-gray-400 hover:text-white')}>
                    {p}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Metas (opcional)</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {KPI_OPTIONS.map((k) => (
            <label key={k.key} className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500">{k.label}</span>
              <input type="number" min={0} value={metas[k.key] ?? ''} onChange={(e) => setMetas((m) => ({ ...m, [k.key]: e.target.value }))}
                className="bg-[#0A0F1E] border border-[#1F2937] rounded-md px-2 py-1.5 text-xs text-gray-200 tabular-nums focus:outline-none focus:border-cyan-500/60" />
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={salvar} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
          {saving ? 'Salvando…' : 'Criar ação'}
        </button>
      </div>
    </div>
  )
}
