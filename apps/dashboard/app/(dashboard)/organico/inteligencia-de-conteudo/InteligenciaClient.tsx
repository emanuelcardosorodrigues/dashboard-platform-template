'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Hash, RefreshCw, Heart, MessageCircle, ExternalLink, Lightbulb, Info, Plug } from 'lucide-react'
import type { SbHashtagMedia, BudgetUsage } from '@/lib/organico/hashtag'

type RankKind = 'top' | 'recent'

export default function InteligenciaClient({
  igConnected, budget, media, limit,
}: {
  igConnected: boolean
  igUserId: string | null
  budget: BudgetUsage | null
  media: SbHashtagMedia[]
  limit: number
}) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [kind, setKind] = useState<RankKind>('top')
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)

  // Hashtags com dado persistido, na ordem de melhor engajamento.
  const hashtags = useMemo(() => {
    const eng = new Map<string, number>()
    for (const m of media) eng.set(m.hashtag, (eng.get(m.hashtag) ?? 0) + (m.like_count ?? 0) + (m.comments_count ?? 0))
    return [...eng.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h)
  }, [media])

  const byHashtag = useMemo(() => {
    const g = new Map<string, SbHashtagMedia[]>()
    for (const m of media) {
      if (m.rank_kind !== kind) continue
      const arr = g.get(m.hashtag) ?? []
      arr.push(m)
      g.set(m.hashtag, arr)
    }
    for (const arr of g.values()) arr.sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0))
    return g
  }, [media, kind])

  const recs = useMemo(() => buildRecommendations(media), [media])

  async function atualizar() {
    const tags = input.split(',').map((s) => s.trim()).filter(Boolean)
    if (tags.length === 0) { setMsg({ kind: 'warn', text: 'Digite ao menos uma hashtag (separe por vírgula).' }); return }
    setMsg(null)
    try {
      const res = await fetch(`/api/organico/hashtag?hashtags=${encodeURIComponent(tags.join(','))}`, { cache: 'no-store' })
      const json = await res.json() as {
        error?: string
        blocked?: string[]
        budget?: { used: number; limit: number; remaining: number }
        results?: { hashtag: string; note?: string; error?: string }[]
      }
      if (res.status === 429) {
        setMsg({ kind: 'err', text: json.error ?? `Orçamento de ${limit} hashtags/7 dias atingido.` })
        return
      }
      if (!res.ok) { setMsg({ kind: 'err', text: json.error ?? `Falha (HTTP ${res.status}).` }); return }
      const bloq = json.blocked?.length ? ` Bloqueadas por orçamento: ${json.blocked.join(', ')}.` : ''
      const naoAchou = (json.results ?? []).filter((r) => r.note === 'hashtag não encontrada').map((r) => r.hashtag)
      const semDado = naoAchou.length ? ` Sem resultado: ${naoAchou.join(', ')}.` : ''
      const rem = json.budget ? ` Saldo: ${json.budget.remaining}/${json.budget.limit}.` : ''
      setMsg({ kind: bloq ? 'warn' : 'ok', text: `Atualizado.${rem}${bloq}${semDado}` })
      setInput('')
      startTransition(() => router.refresh()) // re-lê o agregado persistido (sem gastar orçamento)
    } catch (e) {
      setMsg({ kind: 'err', text: `Erro de rede: ${(e as Error).message}` })
    }
  }

  if (!igConnected) {
    return (
      <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-xl mx-auto mt-6 text-center">
        <Plug size={26} className="mx-auto text-gray-500 mb-3" />
        <h2 className="text-white font-semibold mb-1">Instagram não conectado</h2>
        <p className="text-sm text-gray-400">Conecte uma conta Instagram em <span className="text-gray-200">Admin → Projetos</span> para buscar hashtags públicas do nicho.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Busca + orçamento */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0A0F1E] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-[260px]">
            <span className="text-xs text-gray-400 flex items-center gap-1"><Hash size={12} /> Hashtags do nicho (separe por vírgula)</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !pending) atualizar() }}
              placeholder="ex: odontologia, harmonizacaofacial, dentista"
              className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            />
          </label>
          <button
            onClick={atualizar}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
          >
            <RefreshCw size={14} className={pending ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        {/* Saldo do orçamento */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-[#1F2937] overflow-hidden">
            <div
              className="h-full bg-cyan-500"
              style={{ width: `${budget ? Math.min(100, (budget.used / budget.limit) * 100) : 0}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {budget ? `${budget.used}/${budget.limit} hashtags · ${budget.remaining} restantes (7d)` : 'orçamento indisponível'}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-gray-500 flex items-center gap-1">
          <Info size={11} /> Dados públicos agregados · limite de {limit} hashtags / 7 dias (regra da Meta).
        </p>
        {msg && (
          <div className={`mt-2 rounded-lg border px-3 py-1.5 text-xs ${
            msg.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : msg.kind === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Pauta recomendada (determinística) */}
      {recs.length > 0 && (
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
          <h2 className="text-white font-semibold flex items-center gap-2 mb-2"><Lightbulb size={15} className="text-amber-400" /> Pauta recomendada</h2>
          <ul className="space-y-1.5">
            {recs.map((r, i) => (
              <li key={i} className="text-sm text-gray-300 flex gap-2"><span className="text-cyan-400">•</span> {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Toggle top/recent */}
      {hashtags.length > 0 && (
        <div className="flex items-center gap-2">
          {(['top', 'recent'] as RankKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${kind === k ? 'bg-[#374151] text-white' : 'bg-[#111827] border border-[#1F2937] text-gray-400 hover:text-white'}`}
            >
              {k === 'top' ? 'Top media' : 'Recentes'}
            </button>
          ))}
        </div>
      )}

      {/* Ranking por hashtag */}
      {hashtags.length === 0 ? (
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 text-center text-sm text-gray-400">
          Nenhuma hashtag buscada ainda. Digite as hashtags do nicho acima e clique em <span className="text-gray-200">Atualizar</span>.
        </div>
      ) : (
        hashtags.map((h) => {
          const items = byHashtag.get(h) ?? []
          if (items.length === 0) return null
          return (
            <div key={h} className="rounded-xl border border-[#1F2937] bg-[#111827] p-4">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-1.5"><Hash size={14} className="text-cyan-400" />{h}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((m) => <MediaCard key={m.media_external_id} m={m} />)}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function MediaCard({ m }: { m: SbHashtagMedia }) {
  const likes = m.like_count ?? 0
  const comments = m.comments_count ?? 0
  return (
    <a
      href={m.permalink ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-lg border border-[#1F2937] bg-[#0B1120] overflow-hidden hover:border-cyan-500/40 transition-colors"
    >
      <div className="aspect-square bg-[#0A0F1E] relative overflow-hidden">
        {m.media_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.media_url} alt="" className="w-full h-full object-cover" loading="lazy"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        ) : null}
        <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-wide bg-black/60 text-gray-200 rounded px-1 py-0.5">
          {(m.media_type ?? '').replace('CAROUSEL_ALBUM', 'álbum').toLowerCase() || '—'}
        </span>
        <ExternalLink size={13} className="absolute bottom-1.5 right-1.5 text-white/70 opacity-0 group-hover:opacity-100" />
      </div>
      <div className="p-2">
        <p className="text-[11px] text-gray-400 line-clamp-2 min-h-[28px]">{m.caption ?? ''}</p>
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-300">
          <span className="inline-flex items-center gap-1"><Heart size={11} className="text-rose-400" />{fmt(likes)}</span>
          <span className="inline-flex items-center gap-1"><MessageCircle size={11} className="text-cyan-400" />{fmt(comments)}</span>
        </div>
      </div>
    </a>
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Recomendações determinísticas a partir do agregado (sem IA). */
function buildRecommendations(media: SbHashtagMedia[]): string[] {
  if (media.length < 3) return []
  const out: string[] = []
  const eng = (m: SbHashtagMedia) => (m.like_count ?? 0) + (m.comments_count ?? 0)

  // Formato (media_type) que mais engaja, por MÉDIA.
  const byType = new Map<string, { sum: number; n: number }>()
  for (const m of media) {
    const t = m.media_type ?? '—'
    const c = byType.get(t) ?? { sum: 0, n: 0 }
    c.sum += eng(m); c.n += 1; byType.set(t, c)
  }
  const typeRank = [...byType.entries()].filter(([, c]) => c.n >= 2).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n)
  if (typeRank.length > 0) {
    const [t, c] = typeRank[0]
    out.push(`Formato que mais engaja: ${labelType(t)} (média de ${fmt(Math.round(c.sum / c.n))} interações por post).`)
  }

  // Hashtag com maior engajamento TOTAL no recorte.
  const byTag = new Map<string, number>()
  for (const m of media) byTag.set(m.hashtag, (byTag.get(m.hashtag) ?? 0) + eng(m))
  const tagRank = [...byTag.entries()].sort((a, b) => b[1] - a[1])
  if (tagRank.length > 0) out.push(`Hashtag mais quente do nicho: #${tagRank[0][0]} (${fmt(tagRank[0][1])} interações somadas).`)

  // Post de referência (maior engajamento absoluto).
  const top = [...media].sort((a, b) => eng(b) - eng(a))[0]
  if (top?.permalink) out.push(`Post de referência: ${fmt(eng(top))} interações — abra e modele o gancho/estrutura: ${top.permalink}`)

  // Proporção de comentários (sinal de conversa) vs likes.
  const totL = media.reduce((s, m) => s + (m.like_count ?? 0), 0)
  const totC = media.reduce((s, m) => s + (m.comments_count ?? 0), 0)
  if (totL > 0) {
    const ratio = (totC / totL) * 100
    out.push(ratio >= 3
      ? `Nicho conversador (${ratio.toFixed(1)}% comentários/likes): conteúdo que pede opinião/pergunta tende a performar.`
      : `Nicho de consumo passivo (${ratio.toFixed(1)}% comentários/likes): priorize ganchos de retenção e salvamento.`)
  }
  return out
}

function labelType(t: string): string {
  if (t === 'VIDEO') return 'Vídeo/Reels'
  if (t === 'IMAGE') return 'Imagem'
  if (t === 'CAROUSEL_ALBUM') return 'Carrossel'
  return t
}
