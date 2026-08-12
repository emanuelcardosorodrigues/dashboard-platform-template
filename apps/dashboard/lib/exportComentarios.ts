/**
 * Export de comentários extraídos (Extrair Comentários) → CSV e XLSX.
 * Roda 100% no client (padrão exportPlanejamentoXlsx.ts): o caller busca as
 * rows via /api/extracao-comentarios/[id]/rows (keyset) e chama estas funções.
 * CSV: vírgula + células entre aspas (RFC 4180) + BOM (Excel pt-BR abre certo).
 */
import * as XLSX from 'xlsx'

export interface ComentarioExportRow {
  external_id: string
  parent_external_id: string | null
  author: string | null
  author_channel_url: string | null
  text: string
  like_count: number | null
  reply_count: number | null
  published_at: string | null
}

export interface ExtracaoExportMeta {
  videoId: string
  videoTitle: string | null
  channelTitle: string | null
  url: string
}

/** Agrupa cada thread: raiz seguida das suas replies (ordem original preservada).
 *  Reply órfã (raiz fora do conjunto) vai pro final — nunca some. */
export function ordenarThreads(rows: ComentarioExportRow[]): ComentarioExportRow[] {
  const roots = rows.filter((r) => r.parent_external_id === null)
  const rootIds = new Set(roots.map((r) => r.external_id))
  const byParent = new Map<string, ComentarioExportRow[]>()
  const orfas: ComentarioExportRow[] = []
  for (const r of rows) {
    if (r.parent_external_id === null) continue
    if (!rootIds.has(r.parent_external_id)) { orfas.push(r); continue }
    const list = byParent.get(r.parent_external_id) ?? []
    list.push(r)
    byParent.set(r.parent_external_id, list)
  }
  const out: ComentarioExportRow[] = []
  for (const root of roots) {
    out.push(root)
    out.push(...(byParent.get(root.external_id) ?? []))
  }
  out.push(...orfas)
  return out
}

const CABECALHO = ['Comentário', 'Autor', 'Curtidas', 'Respostas', 'Publicado em', 'Tipo', 'Em resposta a', 'Link'] as const

function dataBr(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  } catch {
    return iso
  }
}

function commentLink(videoId: string, externalId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}&lc=${externalId}`
}

/** Neutraliza CSV/formula injection (CWE-1236): texto de comentário e nome de
 *  autor vêm de QUALQUER pessoa na internet. Uma célula que começa com = + - @
 *  tab ou CR é interpretada como fórmula pelo Excel/Sheets (=HYPERLINK, DDE...),
 *  mesmo entre aspas. Prefixamos com apóstrofo → o app trata como texto literal. */
function neutralizeFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
}

function toCells(meta: ExtracaoExportMeta, r: ComentarioExportRow): (string | number)[] {
  return [
    neutralizeFormula(r.text),
    neutralizeFormula(r.author ?? ''),
    r.like_count ?? '',
    r.reply_count ?? '',
    dataBr(r.published_at),
    r.parent_external_id === null ? 'comentário' : 'resposta',
    r.parent_external_id ?? '',
    commentLink(meta.videoId, r.external_id),
  ]
}

export function buildComentariosCsv(meta: ExtracaoExportMeta, rows: ComentarioExportRow[]): string {
  const ordenadas = ordenarThreads(rows)
  const linhas = [
    [...CABECALHO],
    ...ordenadas.map((r) => toCells(meta, r)),
  ]
  const csv = linhas
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  return '﻿' + csv
}

export function buildComentariosWorkbook(meta: ExtracaoExportMeta, rows: ComentarioExportRow[]): XLSX.WorkBook {
  const ordenadas = ordenarThreads(rows)
  const wb = XLSX.utils.book_new()

  const resumo = [
    { Campo: 'Vídeo', Valor: meta.videoTitle ?? meta.videoId },
    { Campo: 'Canal', Valor: meta.channelTitle ?? '' },
    { Campo: 'URL', Valor: meta.url },
    { Campo: 'Total de comentários (raízes + respostas)', Valor: rows.length },
    { Campo: 'Exportado em', Valor: dataBr(new Date().toISOString()) },
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo')

  const linhas = ordenadas.map((r) => {
    const [comentario, autor, curtidas, respostas, publicado, tipo, pai, link] = toCells(meta, r)
    return {
      'Comentário': comentario,
      'Autor': autor,
      'Curtidas': curtidas,
      'Respostas': respostas,
      'Publicado em': publicado,
      'Tipo': tipo,
      'Em resposta a': pai,
      'Link': link,
    }
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Comentários')
  return wb
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

export function comentariosFileName(meta: ExtracaoExportMeta, ext: 'csv' | 'xlsx'): string {
  const base = meta.videoTitle ? slug(meta.videoTitle) : meta.videoId
  return `comentarios-${base}.${ext}`
}

// ── Export MULTI-VÍDEO (seleção por checkbox no histórico) ───────────────────
// Uma planilha só com os comentários de N extrações: coluna "Vídeo" no início
// de cada linha distingue a origem; no XLSX a aba Resumo lista um vídeo por
// linha. Ordem: vídeos na ordem selecionada; dentro de cada vídeo, threads
// agrupadas (raiz + replies) como no export individual.

export interface ExtracaoComComentarios {
  meta: ExtracaoExportMeta
  rows: ComentarioExportRow[]
}

const CABECALHO_MULTI = ['Vídeo', 'Canal', ...CABECALHO] as const

function toCellsMulti(item: ExtracaoComComentarios, r: ComentarioExportRow): (string | number)[] {
  return [
    // título/canal vêm do YouTube (conteúdo de terceiros) → mesma neutralização
    neutralizeFormula(item.meta.videoTitle ?? item.meta.videoId),
    neutralizeFormula(item.meta.channelTitle ?? ''),
    ...toCells(item.meta, r),
  ]
}

export function buildComentariosMultiCsv(itens: ExtracaoComComentarios[]): string {
  const linhas: (string | number)[][] = [[...CABECALHO_MULTI]]
  for (const item of itens) {
    for (const r of ordenarThreads(item.rows)) linhas.push(toCellsMulti(item, r))
  }
  const csv = linhas
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  return '﻿' + csv
}

/** Nome de aba válido no Excel: sem : \\ / ? * [ ], máx. 31 chars, único.
 *  Título vazio vira o videoId; colisão ganha sufixo (2), (3)... */
export function nomeAbaExcel(titulo: string, usados: Set<string>): string {
  const limpo = titulo.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Video'
  let nome = limpo
  for (let n = 2; usados.has(nome.toLowerCase()); n++) nome = `${limpo.slice(0, 24)} (${n})`
  usados.add(nome.toLowerCase())
  return nome
}

export function buildComentariosMultiWorkbook(itens: ExtracaoComComentarios[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()

  const resumo = itens.map((item) => ({
    'Vídeo': item.meta.videoTitle ?? item.meta.videoId,
    'Canal': item.meta.channelTitle ?? '',
    'URL': item.meta.url,
    'Comentários (raízes + respostas)': item.rows.length,
  }))
  resumo.push({
    'Vídeo': `TOTAL (${itens.length} vídeos)`,
    'Canal': '',
    'URL': '',
    'Comentários (raízes + respostas)': itens.reduce((s, i) => s + i.rows.length, 0),
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Resumo')

  // UMA ABA POR VÍDEO (colunas do export individual — sem coluna Vídeo, a aba já identifica)
  const nomesUsados = new Set<string>(['resumo'])
  for (const item of itens) {
    const linhas = ordenarThreads(item.rows).map((r) => {
      const cells = toCells(item.meta, r)
      const row: Record<string, string | number> = {}
      CABECALHO.forEach((h, i) => { row[h] = cells[i] })
      return row
    })
    const aba = nomeAbaExcel(item.meta.videoTitle ?? item.meta.videoId, nomesUsados)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), aba)
  }
  return wb
}

function multiFileName(itens: ExtracaoComComentarios[], ext: 'csv' | 'xlsx'): string {
  return `comentarios-${itens.length}-videos.${ext}`
}

export function downloadComentariosMultiCsv(itens: ExtracaoComComentarios[]): void {
  const csv = buildComentariosMultiCsv(itens)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = multiFileName(itens, 'csv')
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadComentariosMultiXlsx(itens: ExtracaoComComentarios[]): void {
  XLSX.writeFile(buildComentariosMultiWorkbook(itens), multiFileName(itens, 'xlsx'))
}

/** Baixa o CSV no browser (client-side). */
export function downloadComentariosCsv(meta: ExtracaoExportMeta, rows: ComentarioExportRow[]): void {
  const csv = buildComentariosCsv(meta, rows)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = comentariosFileName(meta, 'csv')
  a.click()
  URL.revokeObjectURL(url)
}

/** Baixa o XLSX no browser (client-side). */
export function downloadComentariosXlsx(meta: ExtracaoExportMeta, rows: ComentarioExportRow[]): void {
  const wb = buildComentariosWorkbook(meta, rows)
  XLSX.writeFile(wb, comentariosFileName(meta, 'xlsx'))
}
