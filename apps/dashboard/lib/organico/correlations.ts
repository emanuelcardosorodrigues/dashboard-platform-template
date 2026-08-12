/**
 * Motor de correlações do Orgânico — 100% DETERMINÍSTICO (regra do dono: IA só
 * pra conteúdo; padrão é código). Cada análise tem GUARDA de amostra mínima:
 * sem amostra, NÃO conclui (não cospe ruído). Saída em PT com números na
 * evidência. Consumido pelo cron organic-insights (cache) e pela página.
 */
import { median } from './scores'

export interface InsightOrganico {
  id: string
  severity: 'alta' | 'media' | 'info'
  titulo: string
  evidencia: string
  recomendacao: string
}

export interface CorrPost {
  id: string
  platform: string
  format: string | null
  published_at: string
  duration_seconds: number | null
  views: number | null
  apv: number | null
  completion_rate: number | null
  likes: number | null
  comments_count: number | null
  shares: number | null
  saves: number | null
  tema: string | null
  traffic_sources: Record<string, number> | null
}
export interface CorrProfileDay {
  date: string
  follows: number | null
  unfollows: number | null
  subs_gained: number | null
  subs_lost: number | null
}
export interface CorrComment { post_id: string; themes: string[] | null }

const MIN_POSTS = 8
const MIN_DIAS = 14
const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function ageDays(iso: string, nowMs: number): number {
  return Math.max(1, (nowMs - new Date(iso).getTime()) / 86400_000)
}
function viewsPerDay(p: CorrPost, nowMs: number): number | null {
  return p.views == null ? null : p.views / ageDays(p.published_at, nowMs)
}
function retencao(p: CorrPost): number | null {
  return p.apv ?? p.completion_rate ?? null
}

export function computeOrganicInsights(
  posts: CorrPost[], profileDaily: CorrProfileDay[], comments: CorrComment[], nowMs: number,
): InsightOrganico[] {
  const out: InsightOrganico[] = []
  const comAlcance = posts.filter((p) => p.views != null && p.views > 0)

  // (a) duração × retenção — faixa que mais retém (só vídeo com retenção+duração)
  if (comAlcance.length >= MIN_POSTS) {
    const faixas: Record<string, number[]> = { '≤35s': [], '36-90s': [], '90s-5min': [], '>5min': [] }
    for (const p of comAlcance) {
      const r = retencao(p)
      if (r == null || p.duration_seconds == null) continue
      const f = p.duration_seconds <= 35 ? '≤35s' : p.duration_seconds <= 90 ? '36-90s' : p.duration_seconds <= 300 ? '90s-5min' : '>5min'
      faixas[f].push(r)
    }
    const medias = Object.entries(faixas)
      .filter(([, v]) => v.length >= 3)
      .map(([f, v]) => ({ f, m: median(v)!, n: v.length }))
      .sort((a, b) => b.m - a.m)
    if (medias.length >= 2) {
      const top = medias[0], bottom = medias[medias.length - 1]
      out.push({
        id: 'duracao-retencao', severity: 'media',
        titulo: `Vídeos de ${top.f} retêm mais`,
        evidencia: `Retenção mediana ${top.m.toFixed(0)}% em ${top.f} (${top.n} posts) vs ${bottom.m.toFixed(0)}% em ${bottom.f}.`,
        recomendacao: `Priorize a duração de ${top.f} pra esse público.`,
      })
    }
  }

  // (b) dia da semana × views/dia (idade normalizada)
  if (comAlcance.length >= MIN_POSTS) {
    const porDia: Record<number, number[]> = {}
    for (const p of comAlcance) {
      const vpd = viewsPerDay(p, nowMs)
      if (vpd == null) continue
      const d = new Date(p.published_at).getDay()
      ;(porDia[d] ??= []).push(vpd)
    }
    const ranked = Object.entries(porDia)
      .filter(([, v]) => v.length >= 2)
      .map(([d, v]) => ({ d: Number(d), m: median(v)!, n: v.length }))
      .sort((a, b) => b.m - a.m)
    if (ranked.length >= 3) {
      const top = ranked[0]
      out.push({
        id: 'melhor-dia', severity: 'info',
        titulo: `${DOW[top.d][0].toUpperCase()}${DOW[top.d].slice(1)} é seu melhor dia de publicação`,
        evidencia: `Posts de ${DOW[top.d]} fazem ${Math.round(top.m)} views/dia na mediana (${top.n} posts) — o maior entre os dias.`,
        recomendacao: `Concentre os lançamentos mais importantes na ${DOW[top.d]}.`,
      })
    }
  }

  // (c) cadência semanal × ganho líquido de seguidores
  if (profileDaily.length >= MIN_DIAS && posts.length >= MIN_POSTS) {
    const semanaKey = (iso: string) => {
      const d = new Date(iso); const onejan = new Date(d.getFullYear(), 0, 1)
      return `${d.getFullYear()}-${Math.ceil(((d.getTime() - onejan.getTime()) / 86400_000 + onejan.getDay() + 1) / 7)}`
    }
    const postsPorSemana = new Map<string, number>()
    for (const p of posts) postsPorSemana.set(semanaKey(p.published_at), (postsPorSemana.get(semanaKey(p.published_at)) ?? 0) + 1)
    const ganhoPorSemana = new Map<string, number>()
    for (const d of profileDaily) {
      const liq = (d.follows ?? 0) - (d.unfollows ?? 0) + (d.subs_gained ?? 0) - (d.subs_lost ?? 0)
      ganhoPorSemana.set(semanaKey(d.date), (ganhoPorSemana.get(semanaKey(d.date)) ?? 0) + liq)
    }
    const altas: number[] = [], baixas: number[] = []
    for (const [sem, ganho] of ganhoPorSemana) {
      const np = postsPorSemana.get(sem) ?? 0
      if (np >= 3) altas.push(ganho); else baixas.push(ganho)
    }
    if (altas.length >= 2 && baixas.length >= 2) {
      const ma = median(altas)!, mb = median(baixas)!
      if (ma > mb * 1.2) {
        out.push({
          id: 'cadencia', severity: 'media',
          titulo: 'Semanas com 3+ posts crescem mais a base',
          evidencia: `Ganho líquido mediano: ${Math.round(ma)} (semanas ≥3 posts) vs ${Math.round(mb)} (semanas mais fracas).`,
          recomendacao: 'Mantenha pelo menos 3 publicações por semana.',
        })
      }
    }
  }

  // (d) fadiga de tema (mediana views/dia caindo ≥30% entre 1ª e 2ª metade)
  {
    const porTema = new Map<string, CorrPost[]>()
    for (const p of comAlcance) {
      if (!p.tema) continue
      ;(porTema.get(p.tema) ?? porTema.set(p.tema, []).get(p.tema)!).push(p)
    }
    for (const [tema, ps] of porTema) {
      if (ps.length < 6) continue
      const ordenados = [...ps].sort((a, b) => a.published_at.localeCompare(b.published_at))
      const meio = Math.floor(ordenados.length / 2)
      const m1 = median(ordenados.slice(0, meio).map((p) => viewsPerDay(p, nowMs)!).filter(Number.isFinite))
      const m2 = median(ordenados.slice(meio).map((p) => viewsPerDay(p, nowMs)!).filter(Number.isFinite))
      if (m1 != null && m2 != null && m1 > 0 && m2 < m1 * 0.7) {
        out.push({
          id: `fadiga-${tema}`, severity: 'alta',
          titulo: `Tema "${tema}" está saturando`,
          evidencia: `Views/dia caíram ${Math.round((1 - m2 / m1) * 100)}% (de ${Math.round(m1)} pra ${Math.round(m2)}) entre os primeiros e os últimos posts do tema.`,
          recomendacao: 'Troque o ângulo desse tema ou descanse-o por algumas semanas.',
        })
      }
    }
  }

  // (e) saúde de distribuição YouTube (descoberta vs anúncio)
  {
    const DESCOBERTA = new Set(['RELATED_VIDEO', 'YT_SEARCH', 'SHORTS', 'SUBSCRIBER', 'HASHTAGS', 'SOUND_PAGE'])
    const PAGO = new Set(['ADVERTISING', 'PROMOTED'])
    let desc = 0, pago = 0, tot = 0
    for (const p of posts) {
      if (p.platform !== 'youtube') continue
      for (const [k, v] of Object.entries(p.traffic_sources ?? {})) {
        tot += v
        if (DESCOBERTA.has(k)) desc += v; else if (PAGO.has(k)) pago += v
      }
    }
    if (tot > 0) {
      const pDesc = desc / tot, pPago = pago / tot
      if (pDesc < 0.2 && pPago > 0.5) {
        out.push({
          id: 'distribuicao-yt', severity: 'alta',
          titulo: 'O YouTube está vivendo de anúncio, não de orgânico',
          evidencia: `Só ${(pDesc * 100).toFixed(0)}% das views vêm de descoberta orgânica; ${(pPago * 100).toFixed(0)}% vêm de anúncio.`,
          recomendacao: 'Otimize título/thumbnail/retenção pra ganhar distribuição orgânica (Browse/Sugeridos/Busca).',
        })
      }
    }
  }

  // (f) tema de comentário dominante em top-quartil vs bottom-quartil de views
  if (comAlcance.length >= MIN_POSTS && comments.length > 0) {
    const ord = [...comAlcance].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    const q = Math.max(1, Math.floor(ord.length / 4))
    const topIds = new Set(ord.slice(0, q).map((p) => p.id))
    const topThemes = new Map<string, number>()
    for (const c of comments) {
      if (!topIds.has(c.post_id)) continue
      for (const t of c.themes ?? []) topThemes.set(t, (topThemes.get(t) ?? 0) + 1)
    }
    const topTheme = [...topThemes.entries()].sort((a, b) => b[1] - a[1])[0]
    if (topTheme && topTheme[1] >= 3) {
      out.push({
        id: 'comentarios-top', severity: 'info',
        titulo: `Posts campeões puxam comentários de "${topTheme[0]}"`,
        evidencia: `"${topTheme[0]}" é o tema de comentário mais frequente nos posts do quartil superior de views (${topTheme[1]} ocorrências).`,
        recomendacao: 'Reforce o que gera esse tipo de reação — é o que acompanha seus melhores conteúdos.',
      })
    }
  }

  return out
}
