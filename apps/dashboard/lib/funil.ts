/**
 * Recorte do funil por Campanha → Conjunto → Anúncio (Meta Ads).
 *
 * `meta_ads` tem campaign_name/adset_name/ad_name/ad_id; `transacoes` só tem
 * ad_id/criativo. Então o recorte é: filtra o meta_ads pela cascata e depois
 * mantém as transações cujas ads (ad_id direto, criativo=ad_name como fallback)
 * sobreviveram. Tudo determinístico ([[feedback_hardcode_over_ai]]).
 */
import type { SbMetaAds, SbTransacao } from './supabase'

export interface AdFilter {
  campanha: string
  conjunto: string
  anuncio: string
}

export const AD_ALL: AdFilter = { campanha: 'all', conjunto: 'all', anuncio: 'all' }

export function adFilterActive(f: AdFilter): boolean {
  return f.campanha !== 'all' || f.conjunto !== 'all' || f.anuncio !== 'all'
}

type MetaLike = { campaign_name: string; adset_name: string; ad_name?: string; ad_id?: string }

/** Aplica campanha → conjunto → anúncio sobre linhas do meta_ads (anúncio casa ad_name OU ad_id). */
export function applyAdFilters<T extends MetaLike>(rows: T[], f: AdFilter): T[] {
  let r = rows
  if (f.campanha !== 'all') r = r.filter((x) => x.campaign_name === f.campanha)
  if (f.conjunto !== 'all') r = r.filter((x) => x.adset_name === f.conjunto)
  if (f.anuncio !== 'all') r = r.filter((x) => x.ad_name === f.anuncio || x.ad_id === f.anuncio)
  return r
}

const uniqSorted = (xs: (string | undefined)[]): string[] =>
  Array.from(new Set(xs.filter((x): x is string => !!x && x.trim() !== ''))).sort((a, b) => a.localeCompare(b, 'pt-BR'))

/**
 * Opções em cascata: conjuntos dependem da campanha escolhida; anúncios dependem
 * de campanha + conjunto. As campanhas sempre saem do escopo inteiro.
 */
export function buildCascadeOptions(
  rows: MetaLike[],
  sel: { campanha: string; conjunto: string },
): { campanhas: string[]; conjuntos: string[]; anuncios: string[] } {
  const campanhas = uniqSorted(rows.map((r) => r.campaign_name))
  const noCamp = sel.campanha === 'all' ? rows : rows.filter((r) => r.campaign_name === sel.campanha)
  const conjuntos = uniqSorted(noCamp.map((r) => r.adset_name))
  const noConj = sel.conjunto === 'all' ? noCamp : noCamp.filter((r) => r.adset_name === sel.conjunto)
  const anuncios = uniqSorted(noConj.map((r) => r.ad_name))
  return { campanhas, conjuntos, anuncios }
}

/**
 * Mantém só as transações pertencentes às ads que sobreviveram ao recorte do meta_ads.
 * Casa por ad_id (vínculo direto) e, como fallback, por criativo == ad_name.
 */
export function filterTransacoesByAds(tx: SbTransacao[], metaFiltered: SbMetaAds[]): SbTransacao[] {
  const ids = new Set(metaFiltered.map((r) => r.ad_id).filter((x): x is string => !!x))
  const names = new Set(metaFiltered.map((r) => (r.ad_name || '').toLowerCase()).filter((x) => x !== ''))
  return tx.filter((t) => (t.ad_id != null && ids.has(t.ad_id)) || (!!t.criativo && names.has(t.criativo.toLowerCase())))
}
