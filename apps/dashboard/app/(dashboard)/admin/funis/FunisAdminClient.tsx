'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import { Plus, Trash2, Save, GripVertical } from 'lucide-react'
import { salvarFunil, deletarFunil } from './actions'
import type { ProdutoRegra, CampanhaRegra, Papel, CampoToken } from '@/lib/funisConfig'

export interface FunilRow {
  id: string
  nome: string
  slug: string
  ordem: number
  ativo: boolean
  cor: string | null
  produtos: ProdutoRegra[]
  campanhas: CampanhaRegra
}

const PAPEIS: { v: Papel; label: string }[] = [
  { v: 'front', label: 'Front-end' },
  { v: 'ob', label: 'Order bump' },
  { v: 'upsell', label: 'Upsell' },
  { v: 'downsell', label: 'Downsell' },
]
const CAMPOS: { v: CampoToken; label: string }[] = [
  { v: 'ad_name', label: 'criativo (ad_name)' },
  { v: 'sck', label: 'sck' },
  { v: 'utm_campaign', label: 'utm_campaign' },
  { v: 'utm_content', label: 'utm_content' },
  { v: 'utm_term', label: 'utm_term' },
  { v: 'campaign_name', label: 'campanha (Meta)' },
]

const novoFunil = (ordem: number): FunilRow => ({
  id: '', nome: '', slug: '', ordem, ativo: true, cor: '#06B6D4',
  produtos: [], campanhas: { habilitado: true, tokens: [], campos: ['ad_name', 'sck', 'campaign_name'] },
})

const inputCls = 'bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-2.5 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/60'

export default function FunisAdminClient({ funisIniciais, produtosDisponiveis, produtosIds = [] }: {
  funisIniciais: FunilRow[]
  produtosDisponiveis: string[]
  /** produtos com ID Hotmart conhecido (migration 0067) — autocomplete da regra por ID. */
  produtosIds?: { id: string; nome: string }[]
}) {
  const [funis, setFunis] = useState<FunilRow[]>(funisIniciais)

  const patch = (idx: number, p: Partial<FunilRow>) =>
    setFunis((prev) => prev.map((f, i) => (i === idx ? { ...f, ...p } : f)))

  return (
    <div className="space-y-5 max-w-4xl">
      <datalist id="produtos-disp">{produtosDisponiveis.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="produtos-ids">
        {produtosIds.map((p) => <option key={p.id} value={p.id} label={p.nome} />)}
      </datalist>

      {funis.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum funil. Crie o primeiro abaixo.</p>
      )}

      {funis.map((f, idx) => (
        <FunilCard key={f.id || `novo-${idx}`} funil={f} onPatch={(p) => patch(idx, p)} produtosIds={produtosIds}
          onRemoveLocal={() => setFunis((prev) => prev.filter((_, i) => i !== idx))} />
      ))}

      <button
        onClick={() => setFunis((prev) => [...prev, novoFunil(prev.length + 1)])}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-cyan-300 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/10"
      >
        <Plus size={15} /> Novo funil
      </button>
    </div>
  )
}

/**
 * Rótulo de conferência da regra por ID: traduz os ids digitados no nome atual do
 * produto. ID sem venda no período consultado aparece como "desconhecido" — não é
 * erro (produto novo ainda não vendeu), só não dá pra confirmar aqui.
 */
function rotuloDosIds(match: string, produtosIds: { id: string; nome: string }[]): string {
  const ids = match.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return ''
  return ids
    .map((id) => produtosIds.find((p) => p.id === id)?.nome ?? `${id} (desconhecido)`)
    .join(' · ')
}

function FunilCard({ funil, onPatch, onRemoveLocal, produtosIds }: {
  funil: FunilRow
  onPatch: (p: Partial<FunilRow>) => void
  onRemoveLocal: () => void
  produtosIds: { id: string; nome: string }[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const setProduto = (i: number, p: Partial<ProdutoRegra>) =>
    onPatch({ produtos: funil.produtos.map((r, j) => (j === i ? { ...r, ...p } : r)) })
  // Nasce POR ID: nome de produto é editável na Hotmart e um rename silencioso
  // desclassifica a venda (já aconteceu em 19/07/2026). O ID não muda.
  const addProduto = () => onPatch({ produtos: [...funil.produtos, { match: '', por: 'id', papel: 'front' }] })
  const delProduto = (i: number) => onPatch({ produtos: funil.produtos.filter((_, j) => j !== i) })
  const setCamp = (p: Partial<CampanhaRegra>) => onPatch({ campanhas: { ...funil.campanhas, ...p } })
  const toggleCampo = (c: CampoToken) => {
    const has = funil.campanhas.campos.includes(c)
    setCamp({ campos: has ? funil.campanhas.campos.filter((x) => x !== c) : [...funil.campanhas.campos, c] })
  }

  const salvar = () => start(async () => {
    setMsg(null)
    const r = await salvarFunil({
      id: funil.id || undefined, nome: funil.nome, cor: funil.cor, ativo: funil.ativo,
      ordem: funil.ordem, produtos: funil.produtos, campanhas: funil.campanhas,
    })
    if (r.ok) { setMsg('Salvo ✓'); router.refresh() } else setMsg(r.error || 'Erro ao salvar')
  })
  const excluir = () => {
    if (!funil.id) { onRemoveLocal(); return }
    if (!confirm(`Excluir o funil "${funil.nome}"?`)) return
    start(async () => {
      const r = await deletarFunil(funil.id)
      if (r.ok) router.refresh(); else setMsg(r.error || 'Erro ao excluir')
    })
  }

  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 flex-wrap">
        <GripVertical size={16} className="text-gray-600 shrink-0" />
        <input value={funil.nome} onChange={(e) => onPatch({ nome: e.target.value })} placeholder="Nome do funil"
          className={clsx(inputCls, 'font-semibold flex-1 min-w-40')} />
        {funil.slug && <span className="text-[11px] text-gray-500 tabular-nums">/{funil.slug}</span>}
        <input type="number" value={funil.ordem} onChange={(e) => onPatch({ ordem: Number(e.target.value) || 0 })}
          className={clsx(inputCls, 'w-16')} title="Ordem" />
        <input type="color" value={funil.cor || '#06B6D4'} onChange={(e) => onPatch({ cor: e.target.value })}
          className="w-8 h-8 rounded bg-transparent border border-[#1F2937] cursor-pointer" title="Cor" />
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={funil.ativo} onChange={(e) => onPatch({ ativo: e.target.checked })} /> Ativo
        </label>
      </div>

      {/* Produtos */}
      <div>
        <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Produtos (papel no funil)</p>
        <div className="space-y-2">
          {funil.produtos.map((p, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-48">
                <input
                  list={p.por === 'id' ? 'produtos-ids' : 'produtos-disp'}
                  value={p.match}
                  onChange={(e) => setProduto(i, { match: e.target.value })}
                  placeholder={p.por === 'id' ? 'ID Hotmart (ex.: PRODUTO_ID_DEMO) — vários separados por vírgula' : 'nome ou parte (ex.: calculadora)'}
                  className={clsx(inputCls, 'w-full')}
                />
                {p.por === 'id' && p.match.trim() !== '' && (
                  <p className="text-[11px] mt-1 px-0.5 text-gray-500">{rotuloDosIds(p.match, produtosIds)}</p>
                )}
              </div>
              {/* Trocar o critério limpa o valor: ID no campo de nome (e vice-versa) não casa nada. */}
              <select value={p.por} onChange={(e) => setProduto(i, { por: e.target.value as 'nome' | 'id', match: '' })} className={inputCls}>
                <option value="id">por ID</option>
                <option value="nome">por nome</option>
              </select>
              <select value={p.papel} onChange={(e) => setProduto(i, { papel: e.target.value as Papel })} className={inputCls}>
                {PAPEIS.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
              </select>
              {p.papel === 'ob' && (
                <select value={p.ordemOb ?? 1} onChange={(e) => setProduto(i, { ordemOb: Number(e.target.value) })} className={inputCls} title="OB nº">
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>OB{n}</option>)}
                </select>
              )}
              <button onClick={() => delProduto(i)} className="text-gray-500 hover:text-rose-400 p-1"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <button onClick={addProduto} className="mt-2 flex items-center gap-1.5 text-xs text-cyan-300 hover:text-cyan-200">
          <Plus size={13} /> Adicionar produto
        </button>
      </div>

      {/* Campanhas */}
      <div className="border-t border-[#1F2937] pt-3">
        <label className="flex items-center gap-2 text-xs text-gray-300 mb-2">
          <input type="checkbox" checked={funil.campanhas.habilitado} onChange={(e) => setCamp({ habilitado: e.target.checked })} />
          Mapear campanhas (atribuir o gasto a este funil)
        </label>
        {funil.campanhas.habilitado && (
          <div className="space-y-2 pl-1">
            <input
              value={funil.campanhas.tokens.join(', ')}
              onChange={(e) => setCamp({ tokens: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="tokens separados por vírgula (ex.: col, calc)" className={clsx(inputCls, 'w-full')} />
            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
              <span>Procurar em:</span>
              {CAMPOS.map((c) => (
                <label key={c.v} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={funil.campanhas.campos.includes(c.v)} onChange={() => toggleCampo(c.v)} /> {c.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-3 border-t border-[#1F2937] pt-3">
        <button onClick={salvar} disabled={pending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50">
          <Save size={14} /> {pending ? 'Salvando…' : 'Salvar'}
        </button>
        <button onClick={excluir} disabled={pending} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-rose-400 hover:bg-rose-500/10 rounded-lg">
          <Trash2 size={14} /> Excluir
        </button>
        {msg && <span className={clsx('text-xs', msg.includes('✓') ? 'text-emerald-400' : 'text-rose-400')}>{msg}</span>}
      </div>
    </div>
  )
}
