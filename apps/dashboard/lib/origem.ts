/**
 * Classificação de ORIGEM de venda — 100% determinística (sem IA), a partir de
 * ad_id + UTMs (last-touch) + sck_slug. Espelha o estilo de PRODUTO_RULES
 * (supabase.ts): o vocabulário é código, não inferência.
 *
 * Baseado nos valores reais da tabela `transacoes` do DEMO:
 *   pago     → ad_id presente OU utm_medium 'pago-metaads' OU placement de mídia
 *   whatsapp → utm contém 'whatsapp'
 *   organico → utm contém 'organico'/'social'/'instagram'/'ig'/...
 *   direto   → resto ('direto'/'direct'/vazio/tagassistant.google.com/hotmart.com)
 */
import { tipoDaTransacao, type SbTransacao } from './supabase'
import { liquidoHotmartVenda } from './hotmartFees'

export type Origem = 'pago' | 'organico' | 'whatsapp' | 'direto'

export const ORIGEM_LABEL: Record<Origem, string> = {
  pago: 'Tráfego pago',
  organico: 'Orgânico',
  whatsapp: 'WhatsApp',
  direto: 'Direto',
}

/** Cor por origem (mesma paleta de status do dashboard). */
export const ORIGEM_COLOR: Record<Origem, string> = {
  pago: '#a855f7', // roxo (tráfego pago)
  organico: '#10b981', // verde
  whatsapp: '#22c55e', // verde-whats
  direto: '#6b7280', // cinza
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

export function classifyOrigem(t: SbTransacao): Origem {
  const adId = norm(t.ad_id) || norm(t.ad_id_primeiro)
  const med = norm(t.utm_medium_ultimo) || norm(t.utm_medium_primeiro)
  const src = norm(t.utm_source_ultimo) || norm(t.utm_source_primeiro)
  const blob = `${med} ${src} ${norm(t.sck_slug)}`

  // 1. PAGO — anúncio Meta confirmado (ad_id) ou UTM/placement de mídia paga.
  if (adId) return 'pago'
  if (/\b(pago|paga)\b|metaads|meta[-_]ads|paid|fbclid|cpc/.test(blob)) return 'pago'
  if (/instagram_(feed|reels|stories|explore)|facebook_|\bfb_|threads_/.test(src)) return 'pago'

  // 2. WHATSAPP
  if (/whats|\bwpp\b|\bwa\b/.test(blob)) return 'whatsapp'

  // 3. ORGÂNICO — social/perfil sem mídia paga.
  if (/organic|organi|social|\bbio\b|perfil|\b(ig|instagram)\b|youtube|tiktok|linktree|telegram/.test(blob)) return 'organico'

  // 4. DIRETO — default (direto/direct/vazio/tagassistant/hotmart.com).
  return 'direto'
}

// ── Segmento de CANAL (seletor do Financeiro) ────────────────────────────────
// Diferente de Origem: agrupa em Pago / Orgânico / Ascensão / Outros a partir do
// utm_medium (que é o que o Financeiro tem por transação). "Ascensão" = venda pra
// base existente (email/whatsapp/recuperação/ascensão/palestra) — não tem gasto Meta.
export type SegmentoCanal = 'pago' | 'organico' | 'ascensao' | 'outros'

export const SEGMENTO_LABEL: Record<SegmentoCanal, string> = {
  pago: 'Pago', organico: 'Orgânico', ascensao: 'Ascensão', outros: 'Outros',
}
export const SEGMENTOS_ORDEM: SegmentoCanal[] = ['pago', 'organico', 'ascensao', 'outros']

/**
 * Classifica uma venda em segmento de canal pelo utm_medium. Ordem importa:
 * pago (mídia) → ascensão (base) → orgânico (social) → outros (direto/vazio/lixo).
 * Casa os valores reais do DEMO: pago-metaads, instagram, organico-instagram, social,
 * email__ascencao, ascencao, ascensao__ascensao, recuperacao, palestra, Instagram_Stories, "0", "".
 */
export function segmentoCanal(utmMedium: string | null | undefined): SegmentoCanal {
  const m = norm(utmMedium)
  if (/pago|paga|metaads|meta[-_]ads|paid|cpc|fbclid|instagram_(feed|reels|stories|explore)|facebook_|\bfb_|threads_/.test(m)) return 'pago'
  if (/ascen|ascens|recupera|palestra|email|whats|\bwpp\b|\bwa\b/.test(m)) return 'ascensao'
  if (/organic|organi|social|instagram|youtube|tiktok|\bbio\b|perfil|linktree|telegram|^ig$/.test(m)) return 'organico'
  return 'outros'
}

export interface OrigemRow {
  origem: Origem
  label: string
  faturamentoBruto: number
  faturamentoLiquido: number
  vendas: number // total de transações
  vendasFront: number // compras frontEnd (produtoToTipo)
}

/** Agrega transações por origem (faturamento bruto/líquido + contagem de vendas). */
export function aggregateByOrigem(transacoes: SbTransacao[]): OrigemRow[] {
  const acc = new Map<Origem, { bruto: number; liquido: number; vendas: number; front: number }>()
  for (const t of transacoes) {
    const o = classifyOrigem(t)
    const a = acc.get(o) ?? { bruto: 0, liquido: 0, vendas: 0, front: 0 }
    const v = t.valor_bruto || 0
    a.bruto += v
    a.liquido += liquidoHotmartVenda(v) // líquido POR transação (taxa Hotmart canônica)
    a.vendas += 1
    if (tipoDaTransacao(t) === 'frontEnd') a.front += 1
    acc.set(o, a)
  }
  const ordem: Origem[] = ['pago', 'organico', 'whatsapp', 'direto']
  return ordem
    .filter((o) => acc.has(o))
    .map((o) => {
      const a = acc.get(o)!
      return {
        origem: o,
        label: ORIGEM_LABEL[o],
        faturamentoBruto: a.bruto,
        faturamentoLiquido: a.liquido,
        vendas: a.vendas,
        vendasFront: a.front,
      }
    })
}
