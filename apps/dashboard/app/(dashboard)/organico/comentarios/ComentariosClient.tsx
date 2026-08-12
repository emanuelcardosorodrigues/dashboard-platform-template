'use client'

/**
 * UI da aba Análises de Comentários. Determinístico vem pronto do server; a
 * leitura de IA (dores/dificuldades/oportunidades/desejos/dúvidas) vem do cache
 * com botão "Atualizar análise". Feed filtrável + confirmação de palavras-gatilho.
 */
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import {
  Users, FileText, HelpCircle, Smile, Trophy, Hash, Zap, ShoppingCart, ShieldQuestion,
  Lightbulb, Sparkles, AlertTriangle, ExternalLink, Search, Download, RefreshCw, Check, X,
} from 'lucide-react'
import { TEMAS_COMENTARIO } from '@/lib/organico/taxonomiaComentarios'
import { formatNumber } from '@/lib/formatters'
import { confirmarGatilho, removerGatilho, atualizarAnaliseComentarios } from './actions'

interface Row {
  id: string; autor: string | null; texto: string; likes: number; replies: number
  data: string | null; sentiment: 'positivo' | 'negativo' | 'neutro' | null
  themes: string[]; pergunta: boolean; postTitulo: string; postLink: string | null; postThumb: string | null
}
interface Item { titulo: string; evidencia: string; freq: number | null }
interface Insights { dores: Item[]; dificuldades: Item[]; oportunidades: Item[]; desejos: Item[]; duvidas: Item[] }

const temaLabel = (k: string) => TEMAS_COMENTARIO[k]?.label ?? k
const SENT_CLS: Record<string, string> = {
  positivo: 'text-emerald-300 bg-emerald-500/10', negativo: 'text-rose-300 bg-rose-500/10', neutro: 'text-gray-400 bg-white/5',
}
const tooltipStyle = { backgroundColor: '#0B1120', border: '1px solid #1F2937', borderRadius: 8, fontSize: 12, color: '#E5E7EB' }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[#1F2937] bg-[#111827] p-4 ${className}`}>{children}</div>
}
function dataHora(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

function Comentario({ r }: { r: Row }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
      <div className="flex items-center gap-2 mb-1 text-[11px]">
        <span className="font-medium text-gray-200 truncate max-w-[140px]">{r.autor ? `@${r.autor}` : 'anônimo'}</span>
        {r.sentiment && <span className={`rounded px-1.5 py-0.5 ${SENT_CLS[r.sentiment]}`}>{r.sentiment}</span>}
        {r.pergunta && <span className="rounded px-1.5 py-0.5 bg-blue-500/15 text-blue-300">pergunta</span>}
        <span className="ml-auto text-gray-600">{dataHora(r.data)}</span>
      </div>
      <p className="text-xs text-gray-300 leading-snug">{r.texto || '—'}</p>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-500">
        {r.likes > 0 && <span>♥ {formatNumber(r.likes)}</span>}
        {r.themes.slice(0, 3).map((t) => <span key={t} className="rounded bg-white/5 px-1.5 py-0.5">{temaLabel(t)}</span>)}
        {(r.postThumb || r.postTitulo || r.postLink) && (
          <a
            href={r.postLink ?? '#'} target="_blank" rel="noreferrer"
            title={`No post: ${r.postTitulo || 'post'}`}
            className={`ml-auto inline-flex items-center gap-1.5 rounded border border-white/5 bg-white/[0.03] pl-0.5 pr-1.5 py-0.5 ${r.postLink ? 'hover:text-gray-200 hover:border-white/15' : 'pointer-events-none'}`}
          >
            {r.postThumb
              ? // eslint-disable-next-line @next/next/no-img-element
                <img src={r.postThumb} alt="" className="w-5 h-6 rounded object-cover shrink-0" loading="lazy" />
              : <span className="w-5 h-6 rounded bg-white/5 shrink-0" />}
            <span className="max-w-[120px] truncate">{r.postTitulo || 'post'}</span>
            {r.postLink && <ExternalLink size={10} className="shrink-0" />}
          </a>
        )}
      </div>
    </div>
  )
}

const SECOES: Array<{ key: keyof Insights; label: string; icon: React.ReactNode; cls: string }> = [
  { key: 'dores', label: 'Dores', icon: <AlertTriangle size={14} />, cls: 'text-rose-300 border-rose-500/20' },
  { key: 'dificuldades', label: 'Dificuldades ocultas', icon: <ShieldQuestion size={14} />, cls: 'text-amber-300 border-amber-500/20' },
  { key: 'oportunidades', label: 'Oportunidades', icon: <Lightbulb size={14} />, cls: 'text-emerald-300 border-emerald-500/20' },
  { key: 'desejos', label: 'Desejos', icon: <Sparkles size={14} />, cls: 'text-fuchsia-300 border-fuchsia-500/20' },
  { key: 'duvidas', label: 'Dúvidas que mais repetem', icon: <HelpCircle size={14} />, cls: 'text-blue-300 border-blue-500/20' },
]

export default function ComentariosClient({
  rows, kpis, autores, posts, palavras, gatilhos, sentSerie, insights, insightsComputedAt, insightsAmostra,
}: {
  rows: Row[]
  kpis: { total: number; autores: number; perguntasPct: number; sentimentoLiquido: number }
  autores: Array<{ handle: string; comentarios: number; likes: number }>
  posts: Array<{ postId: string; titulo: string; permalink: string | null; thumb: string | null; platform: string; comentarios: number }>
  palavras: Array<{ palavra: string; freq: number }>
  gatilhos: Array<{ palavra: string; comentarios: number; confirmado: boolean }>
  sentSerie: Array<{ date: string; positivo: number; negativo: number; neutro: number }>
  insights: Insights
  insightsComputedAt: string | null
  insightsAmostra: number | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [fSent, setFSent] = useState<'todos' | 'positivo' | 'negativo' | 'neutro'>('todos')
  const [fTema, setFTema] = useState<string>('todos')
  const [soPerguntas, setSoPerguntas] = useState(false)

  const leads = useMemo(() => rows.filter((r) => r.themes.includes('interesse_compra')), [rows])
  const objecoes = useMemo(() => rows.filter((r) => r.themes.some((t) => t === 'preco_objecao' || t === 'ceticismo')), [rows])
  const pauta = useMemo(() => rows.filter((r) => r.themes.includes('pedido_de_conteudo')), [rows])
  const semResposta = useMemo(() => rows.filter((r) => r.pergunta && r.replies === 0), [rows])

  const feedAll = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return rows.filter((r) => {
      if (fSent !== 'todos' && r.sentiment !== fSent) return false
      if (fTema !== 'todos' && !r.themes.includes(fTema)) return false
      if (soPerguntas && !r.pergunta) return false
      if (q && !(r.texto.toLowerCase().includes(q) || (r.autor ?? '').toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, busca, fSent, fTema, soPerguntas])

  const feed = useMemo(() => feedAll.slice(0, 400), [feedAll])

  function exportFeed() {
    const cabecalho = ['autor', 'comentario', 'data', 'sentimento', 'temas', 'pergunta', 'likes', 'respostas', 'post', 'post_link']
    const linhas = feedAll.map((r) => [
      r.autor ?? '',
      r.texto.replace(/"/g, "'"),
      r.data ? new Date(r.data).toLocaleString('pt-BR') : '',
      r.sentiment ?? '',
      r.themes.map(temaLabel).join('; '),
      r.pergunta ? 'sim' : 'não',
      String(r.likes),
      String(r.replies),
      r.postTitulo,
      r.postLink ?? '',
    ])
    const csv = [cabecalho, ...linhas].map((l) => l.map((c) => `"${c}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'comentarios.csv'; a.click(); URL.revokeObjectURL(url)
  }

  function exportLeads() {
    const linhas = [['autor', 'comentario', 'data', 'post'], ...leads.map((r) => [r.autor ?? '', r.texto.replace(/"/g, "'"), r.data ?? '', r.postLink ?? ''])]
    const csv = linhas.map((l) => l.map((c) => `"${c}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'leads-comentarios.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const temInsights = SECOES.some((s) => insights[s.key].length > 0)

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Comentários" value={formatNumber(kpis.total)} icon={<FileText size={15} />} />
        <Kpi label="Autores únicos" value={formatNumber(kpis.autores)} icon={<Users size={15} />} />
        <Kpi label="% perguntas" value={`${kpis.perguntasPct}%`} icon={<HelpCircle size={15} />} />
        <Kpi label="Sentimento líquido" value={`${kpis.sentimentoLiquido >= 0 ? '+' : ''}${formatNumber(kpis.sentimentoLiquido)}`} icon={<Smile size={15} />} sub="positivos − negativos" />
      </div>

      {/* IA: dores / dificuldades / oportunidades / desejos / dúvidas */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-fuchsia-400" />
          <h3 className="text-sm font-semibold text-gray-200">Leitura do público (IA)</h3>
          <span className="text-[11px] text-gray-600">
            {insightsComputedAt ? `atualizado ${new Date(insightsComputedAt).toLocaleString('pt-BR')} · ${insightsAmostra ?? 0} comentários` : 'ainda não gerado'}
          </span>
          <button
            onClick={() => start(async () => {
              setErroAcao(null)
              const res = await atualizarAnaliseComentarios()
              if (!res.ok) { setErroAcao(res.erro ?? 'Falha ao atualizar a análise'); return }
              router.refresh()
            })}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50"
          >
            <RefreshCw size={12} className={pending ? 'animate-spin' : ''} /> Atualizar análise
          </button>
        </div>
        {erroAcao && (
          <p className="text-[11px] text-rose-400 mt-1">Não foi possível atualizar: {erroAcao}</p>
        )}
        {!temInsights ? (
          <p className="text-xs text-gray-500 py-4 text-center">
            Clique em &quot;Atualizar análise&quot; para a IA ler os comentários e extrair dores, dificuldades ocultas, oportunidades, desejos e dúvidas.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {SECOES.map((s) => (
              <div key={s.key} className={`rounded-lg border bg-black/20 p-3 ${s.cls}`}>
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-2">{s.icon} {s.label}</div>
                {insights[s.key].length === 0
                  ? <p className="text-[11px] text-gray-600">—</p>
                  : <ul className="space-y-1.5">
                      {insights[s.key].map((it, i) => (
                        <li key={i} className="text-[11px]">
                          <span className="text-gray-200">{it.titulo}</span>
                          {it.freq != null && <span className="text-gray-600"> ({it.freq})</span>}
                          {it.evidencia && <span className="block text-gray-500 italic">&ldquo;{it.evidencia}&rdquo;</span>}
                        </li>
                      ))}
                    </ul>}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Quem mais comenta + Posts mais comentados */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><Trophy size={14} className="text-amber-400" /> Quem mais comenta</h3>
          <div className="space-y-1">
            {autores.length === 0 && <p className="text-xs text-gray-600">—</p>}
            {autores.map((a, i) => (
              <div key={a.handle} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-gray-600 tabular-nums">{i + 1}</span>
                <span className="text-gray-200 truncate flex-1">@{a.handle}</span>
                {a.likes > 0 && <span className="text-gray-600">♥ {formatNumber(a.likes)}</span>}
                <span className="text-fuchsia-300 font-medium tabular-nums">{a.comentarios}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><FileText size={14} className="text-gray-400" /> Posts mais comentados</h3>
          <div className="space-y-1.5">
            {posts.length === 0 && <p className="text-xs text-gray-600">—</p>}
            {posts.map((p) => (
              <a key={p.postId} href={p.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 group">
                {p.thumb
                  ? // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumb} alt="" className="w-7 h-9 rounded object-cover shrink-0" />
                  : <div className="w-7 h-9 rounded bg-white/5 shrink-0" />}
                <span className="text-xs text-gray-300 group-hover:text-white truncate flex-1">{p.titulo}</span>
                <span className="text-fuchsia-300 font-medium text-xs tabular-nums">{p.comentarios}</span>
              </a>
            ))}
          </div>
        </Card>
      </div>

      {/* Palavras + Gatilhos */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-1 flex items-center gap-2"><Hash size={14} className="text-gray-400" /> Palavras que mais repetem</h3>
          <p className="text-[11px] text-gray-600 mb-3">Sem stopwords nem palavras-gatilho confirmadas.</p>
          <div className="flex flex-wrap gap-1.5">
            {palavras.length === 0 && <p className="text-xs text-gray-600">—</p>}
            {palavras.map((w) => (
              <span key={w.palavra} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300">
                {w.palavra} <span className="text-gray-600">{w.freq}</span>
              </span>
            ))}
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-1 flex items-center gap-2"><Zap size={14} className="text-yellow-400" /> Palavras-gatilho de automação</h3>
          <p className="text-[11px] text-gray-600 mb-3">Comentários de 1 palavra que repetem. Confirme os que são gatilho de automação.</p>
          <div className="space-y-1">
            {gatilhos.length === 0 && <p className="text-xs text-gray-600">Nenhum candidato no período.</p>}
            {gatilhos.map((g) => (
              <div key={g.palavra} className="flex items-center gap-2 text-xs">
                <span className={`font-mono ${g.confirmado ? 'text-yellow-300' : 'text-gray-300'}`}>{g.palavra}</span>
                {g.confirmado && <span className="rounded bg-yellow-500/15 text-yellow-300 px-1.5 py-0.5 text-[10px]">gatilho</span>}
                <span className="ml-auto text-gray-500 tabular-nums">{g.comentarios}×</span>
                {g.confirmado
                  ? <button onClick={() => start(async () => { await removerGatilho(g.palavra); router.refresh() })} disabled={pending} title="Remover gatilho" className="text-gray-500 hover:text-rose-400"><X size={13} /></button>
                  : <button onClick={() => start(async () => { await confirmarGatilho(g.palavra); router.refresh() })} disabled={pending} title="Confirmar como gatilho" className="text-gray-500 hover:text-emerald-400"><Check size={13} /></button>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Mineração pra vendas */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={14} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-gray-300">Leads quentes <span className="text-gray-600">({leads.length})</span></h3>
            {leads.length > 0 && <button onClick={exportLeads} className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"><Download size={12} /> CSV</button>}
          </div>
          <p className="text-[11px] text-gray-600 mb-2">Quem demonstrou interesse de compra (preço/link/&quot;quero&quot;).</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {leads.length === 0 ? <p className="text-xs text-gray-600">Nenhum no período.</p> : leads.slice(0, 60).map((r) => <Comentario key={r.id} r={r} />)}
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-1 flex items-center gap-2"><ShieldQuestion size={14} className="text-amber-400" /> Banco de objeções <span className="text-gray-600">({objecoes.length})</span></h3>
          <p className="text-[11px] text-gray-600 mb-2">Preço e ceticismo — munição pra copy de criativo/VSL.</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {objecoes.length === 0 ? <p className="text-xs text-gray-600">Nenhuma no período.</p> : objecoes.slice(0, 60).map((r) => <Comentario key={r.id} r={r} />)}
          </div>
        </Card>
      </div>

      {/* Pauta + Perguntas sem resposta */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2"><Lightbulb size={14} className="text-blue-400" /> Pauta pedida <span className="text-gray-600">({pauta.length})</span></h3>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {pauta.length === 0 ? <p className="text-xs text-gray-600">Ninguém pediu conteúdo no período.</p> : pauta.slice(0, 60).map((r) => <Comentario key={r.id} r={r} />)}
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold text-gray-300 mb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-rose-400" /> Perguntas sem resposta <span className="text-gray-600">({semResposta.length})</span></h3>
          <p className="text-[11px] text-gray-600 mb-2">Comentário-pergunta sem nenhuma resposta = oportunidade (ou venda) perdida.</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {semResposta.length === 0 ? <p className="text-xs text-gray-600">Tudo respondido por aqui.</p> : semResposta.slice(0, 60).map((r) => <Comentario key={r.id} r={r} />)}
          </div>
        </Card>
      </div>

      {/* Sentimento no tempo */}
      <Card>
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2"><Smile size={14} className="text-gray-400" /> Sentimento ao longo do tempo</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sentSerie} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="date" tick={{ fill: '#6B7280', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} width={36} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="positivo" stackId="s" fill="#34D399" radius={[2, 2, 0, 0]} />
              <Bar dataKey="neutro" stackId="s" fill="#6B7280" />
              <Bar dataKey="negativo" stackId="s" fill="#FB7185" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Feed filtrável */}
      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="text-sm font-semibold text-gray-300">Todos os comentários</h3>
          <div className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md border border-[#1F2937] bg-[#0B1120]">
            <Search size={12} className="text-gray-500" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar..." className="bg-transparent text-xs text-gray-200 outline-none w-36" />
          </div>
          <select value={fSent} onChange={(e) => setFSent(e.target.value as typeof fSent)} className="rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-xs text-gray-300">
            <option value="todos">Sentimento: todos</option>
            <option value="positivo">Positivo</option>
            <option value="negativo">Negativo</option>
            <option value="neutro">Neutro</option>
          </select>
          <select value={fTema} onChange={(e) => setFTema(e.target.value)} className="rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-xs text-gray-300">
            <option value="todos">Tema: todos</option>
            {Object.keys(TEMAS_COMENTARIO).map((k) => <option key={k} value={k}>{temaLabel(k)}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={soPerguntas} onChange={(e) => setSoPerguntas(e.target.checked)} className="accent-blue-500" /> só perguntas
          </label>
          <span className="text-[11px] text-gray-600">{feedAll.length}</span>
          {feedAll.length > 0 && (
            <button onClick={exportFeed} className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors">
              <Download size={12} /> Exportar
            </button>
          )}
        </div>
        <div className="grid md:grid-cols-2 gap-2 max-h-[32rem] overflow-y-auto">
          {feed.length === 0 ? <p className="text-xs text-gray-600 col-span-full py-6 text-center">Nenhum comentário nesse recorte.</p> : feed.map((r) => <Comentario key={r.id} r={r} />)}
        </div>
      </Card>
    </div>
  )
}

function Kpi({ label, value, icon, sub }: { label: string; value: string; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
      <div className="flex items-center gap-2 text-gray-400 text-[11px] uppercase tracking-wider mb-1">{icon} {label}</div>
      <p className="text-xl font-bold text-white">{value}</p>
      {sub && <p className="text-[10px] text-gray-600">{sub}</p>}
    </div>
  )
}
