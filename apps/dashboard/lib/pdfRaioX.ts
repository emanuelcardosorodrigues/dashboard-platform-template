/**
 * Renderiza um RaioXReport como PDF usando pdfkit.
 *
 * Layout (1 página de capa + 1 página por janela 30d/15d/7d):
 *  - Capa: título "Análise RAIO-X da Escala", funil, conta, período, players
 *  - Página por janela: 4 blocos (Métricas Gerais / Tráfego / VSL / Engajamento)
 *    em grid 2-colunas com label esquerda + valor à direita.
 *
 * Fonte default Helvetica (embarcada na pdfkit, sem download). Cores em hex.
 */

import PDFDocument from 'pdfkit'
import type { RaioXReport, RaioXMetrics, RaioXWindow } from './raioX'
import { computeMetrics, formatDuration, funilLabel, contaLabel } from './raioX'
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent, formatRoas, formatDateBR } from './formatters'

// Cores (alinhadas com o dark theme do dashboard)
const C = {
  bg:        '#0B1220',
  bgAlt:     '#111827',
  text:      '#F9FAFB',
  textMuted: '#9CA3AF',
  accent:    '#3462EE',
  divider:   '#1F2937',
  positive:  '#10B981',
  negative:  '#EF4444',
  warning:   '#F59E0B',
  card:      '#0F172A',
  cardBorder:'#1E293B',
}

interface Row {
  label: string
  value: string
  note?: string
}

function metricsToRowsGerais(m: RaioXMetrics): Row[] {
  return [
    { label: 'Investimento', value: formatCurrency(m.investimento) },
    { label: 'Faturamento',  value: formatCurrency(m.faturamento) },
    { label: 'Lucro',        value: formatCurrency(m.lucro), note: 'após taxa Hotmart' },
    { label: 'ROAS Bruto',   value: formatRoas(m.roi) },
    { label: 'ROAS Líquido', value: formatRoas(m.roasLiquido), note: 'após taxa Hotmart' },
    { label: 'CPA',          value: formatCurrency(m.cpa) },
    { label: 'ARPU',         value: formatCurrency(m.arpu), note: 'ticket médio FE' },
  ]
}

function metricsToRowsTrafego(m: RaioXMetrics): Row[] {
  return [
    { label: 'CPM',                  value: formatCurrency(m.cpm) },
    { label: 'CTR',                  value: formatPercent(m.ctr, 2) },
    { label: 'CPC',                  value: formatCurrency(m.cpc) },
    { label: 'Connect Rate',         value: formatPercent(m.connectRate, 1), note: 'LPV / cliques' },
    { label: 'CPV',                  value: formatCurrency(m.cpv), note: 'custo / LPV' },
    { label: 'CPI',                  value: formatCurrency(m.cpi), note: 'custo / checkout iniciado' },
    { label: 'Conversão / Page View',value: formatPercent(m.convPagina, 2) },
  ]
}

function metricsToRowsVsl(m: RaioXMetrics, w: RaioXWindow, multi: boolean, pitchOverride: number | null): Row[] {
  const tempoVslLabel = multi ? 'Tempo Total (todos VSLs)' : 'Tempo da VSL'
  const hasPitch = pitchOverride != null
  // Pitch manual: vira sempre "Tempo do Pitch" (não faz sentido "total" quando preenchido à mão).
  const tempoPitchLabel = hasPitch || !multi ? 'Tempo do Pitch' : 'Pitch Total (todos VSLs)'
  const tempoPitchValue = hasPitch
    ? formatDuration(pitchOverride)
    : w.vsl.playerCount > 0 ? formatDuration(m.tempoPitch) : '—'
  return [
    { label: tempoVslLabel,   value: w.vsl.playerCount > 0 ? formatDuration(m.tempoVsl) : '—' },
    { label: tempoPitchLabel, value: tempoPitchValue },
    { label: 'Play Rate',     value: w.vsl.stats ? formatPercent(m.playRate, 1) : '—' },
  ]
}

function metricsToRowsEngaj(m: RaioXMetrics, w: RaioXWindow): Row[] {
  const noData = !w.vsl.stats
  return [
    { label: 'Retenção ao Pitch',  value: noData ? '—' : formatPercent(m.retencaoPitch, 1) },
    { label: 'Cliques no Botão',   value: noData ? '—' : formatNumber(m.cliquesBotao) },
    { label: 'Conversões',         value: noData ? '—' : formatNumber(m.conversoes) },
    { label: 'Taxa de Conversão',  value: noData ? '—' : formatPercent(m.taxaConversao, 2) },
    { label: 'RPV (Revenue/View)', value: noData ? '—' : formatCurrency(m.rpv) },
  ]
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

function drawDivider(doc: InstanceType<typeof PDFDocument>, y: number, x1: number, x2: number) {
  doc.save().lineWidth(0.5).strokeColor(C.divider).moveTo(x1, y).lineTo(x2, y).stroke().restore()
}

function drawSectionTitle(doc: InstanceType<typeof PDFDocument>, title: string, x: number, y: number, w: number): number {
  doc.save()
    .fillColor(C.accent).font('Helvetica-Bold').fontSize(11)
    .text(title.toUpperCase(), x, y, { width: w, characterSpacing: 1.5, lineBreak: false })
    .restore()
  const next = y + 18
  drawDivider(doc, next, x, x + w)
  return next + 8
}

function drawRow(doc: InstanceType<typeof PDFDocument>, row: Row, x: number, y: number, w: number): number {
  const labelW = w * 0.55
  const valueW = w * 0.45
  doc.save()
    .fillColor(C.text).font('Helvetica').fontSize(9.5)
    .text(row.label, x, y, { width: labelW, lineBreak: false, ellipsis: true })
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10.5)
    .text(row.value, x + labelW, y - 1, { width: valueW, align: 'right', lineBreak: false, ellipsis: true })
  doc.restore()
  let next = y + 14
  if (row.note) {
    doc.save()
      .fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(7.5)
      .text(row.note, x, next - 2, { width: w, lineBreak: false, ellipsis: true })
      .restore()
    next += 10
  }
  return next
}

function drawCard(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  rows: Row[],
  x: number, y: number, w: number,
): number {
  const startY = y
  const cardPadding = 12
  // Mede altura (linhas + título + padding)
  const titleHeight = 20
  const rowHeight = (r: Row) => r.note ? 24 : 14
  const contentHeight = rows.reduce((s, r) => s + rowHeight(r), 0)
  const totalHeight = titleHeight + contentHeight + cardPadding * 2

  doc.save()
    .roundedRect(x, startY, w, totalHeight, 8)
    .fillAndStroke(C.card, C.cardBorder)
    .restore()

  let cursor = startY + cardPadding
  cursor = drawSectionTitle(doc, title, x + cardPadding, cursor, w - cardPadding * 2)
  for (const r of rows) {
    cursor = drawRow(doc, r, x + cardPadding, cursor, w - cardPadding * 2)
  }
  return startY + totalHeight + 10
}

function fillPage(doc: InstanceType<typeof PDFDocument>) {
  doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(C.bg).restore()
}

function drawCover(doc: InstanceType<typeof PDFDocument>, report: RaioXReport) {
  fillPage(doc)
  const cx = doc.page.width / 2
  const top = 120

  // Pílula da marca
  doc.save()
    .roundedRect(cx - 80, top, 160, 26, 13)
    .fillAndStroke(C.bgAlt, C.cardBorder)
  doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(10)
    .text('VÉRITAS CLUB', cx - 80, top + 8, { width: 160, align: 'center', characterSpacing: 2, lineBreak: false })
    .restore()

  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(36)
    .text('Análise', 60, top + 60, { width: doc.page.width - 120, align: 'center', lineBreak: false })
  doc.fillColor(C.accent).font('Helvetica-Bold').fontSize(36)
    .text('RAIO-X DA ESCALA', 60, top + 110, { width: doc.page.width - 120, align: 'center', lineBreak: false })

  doc.fillColor(C.textMuted).font('Helvetica').fontSize(13)
    .text('Relatório consolidado de performance · 30 / 15 / 7 dias', 60, top + 165, { width: doc.page.width - 120, align: 'center', lineBreak: false })

  // Card de metadados
  const metaX = 80
  const metaW = doc.page.width - 160
  const metaY = top + 220
  const metaH = 220
  doc.save()
    .roundedRect(metaX, metaY, metaW, metaH, 12)
    .fillAndStroke(C.card, C.cardBorder)
    .restore()

  const innerX = metaX + 28
  const innerW = metaW - 56
  let cy = metaY + 28
  cy = drawSectionTitle(doc, 'Informações Gerais', innerX, cy, innerW)
  cy = drawRow(doc, { label: 'Funil', value: funilLabel(report.funil) }, innerX, cy, innerW)
  cy = drawRow(doc, { label: 'Conta Meta', value: contaLabel(report.conta, report.contaRotulo) }, innerX, cy, innerW)
  cy = drawRow(doc, { label: 'Gerado em', value: formatDateBR(report.geradoEmBR) }, innerX, cy, innerW)
  const playersLabel = report.playerNames.length === 0
    ? 'Nenhum (VSL omitido)'
    : report.playerNames.length === 1
      ? report.playerNames[0]
      : `${report.playerNames.length} VSLs agregadas`
  cy = drawRow(doc, { label: 'VSLs', value: playersLabel }, innerX, cy, innerW)

  // Footer da capa
  doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(8.5)
    .text(
      'Dados em UTC-3 (Brasília). Métricas de tráfego vêm do Meta Ads (com imposto BR), vendas da Hotmart, e métricas de vídeo da vTurb.',
      60, doc.page.height - 80, { width: doc.page.width - 120, align: 'center', lineBreak: true }
    )
}

function drawWindowPage(doc: InstanceType<typeof PDFDocument>, w: RaioXWindow, report: RaioXReport, pitchOverride: number | null) {
  doc.addPage()
  fillPage(doc)

  // Cabeçalho da página
  const padX = 50
  const usableW = doc.page.width - padX * 2

  doc.fillColor(C.textMuted).font('Helvetica').fontSize(9)
    .text(funilLabel(report.funil).toUpperCase(), padX, 50, { width: usableW, characterSpacing: 1.5, lineBreak: false })
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(24)
    .text(w.label, padX, 70, { width: usableW, lineBreak: false })
  doc.fillColor(C.textMuted).font('Helvetica').fontSize(10)
    .text(`${formatDateBR(w.from)} — ${formatDateBR(w.to)}`, padX, 102, { width: usableW, lineBreak: false })

  drawDivider(doc, 130, padX, padX + usableW)

  const metrics = computeMetrics(w)
  const multi = w.vsl.playerCount > 1

  // Grid 2 colunas
  const gap = 16
  const colW = (usableW - gap) / 2
  const leftX = padX
  const rightX = padX + colW + gap
  const topY = 150

  let leftCursor = topY
  let rightCursor = topY

  leftCursor = drawCard(doc, 'Métricas Gerais', metricsToRowsGerais(metrics), leftX, leftCursor, colW)
  rightCursor = drawCard(doc, 'Tráfego', metricsToRowsTrafego(metrics), rightX, rightCursor, colW)

  // Alinha os dois lados pelo maior cursor antes de seguir
  const afterTopRow = Math.max(leftCursor, rightCursor)
  leftCursor = afterTopRow
  rightCursor = afterTopRow

  leftCursor = drawCard(doc, 'VSL (Vídeo Sales Letter)', metricsToRowsVsl(metrics, w, multi, pitchOverride), leftX, leftCursor, colW)
  rightCursor = drawCard(doc, 'Engajamento', metricsToRowsEngaj(metrics, w), rightX, rightCursor, colW)

  // Linha de rodapé com volumes brutos
  const footerY = doc.page.height - 70
  drawDivider(doc, footerY - 12, padX, padX + usableW)
  const s = w.summary
  doc.fillColor(C.textMuted).font('Helvetica').fontSize(8.5)
    .text(
      `Impressões: ${formatNumber(s.impressoes)}  ·  Cliques: ${formatNumber(s.cliques)}  ·  LPV: ${formatNumber(s.landingViews)}  ·  Checkouts: ${formatNumber(s.checkouts)}  ·  Vendas FE: ${formatNumber(s.vendasFront)}  ·  Faturamento bruto: ${formatCurrencyCompact(s.faturamento)}`,
      padX, footerY, { width: usableW, align: 'center', lineBreak: false }
    )
}

// ─── API pública ──────────────────────────────────────────────────────────────

export async function renderRaioXPdf(report: RaioXReport, pitchOverride: number | null = null): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      autoFirstPage: true,
      info: {
        Title: 'RAIO-X DA ESCALA — Véritas Club',
        Author: 'Dashboard DEMO',
        Subject: `Relatório consolidado 30/15/7 dias — ${funilLabel(report.funil)}`,
        Producer: 'Dashboard DEMO dashboard-demo',
      },
    })

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    drawCover(doc, report)
    for (const w of report.windows) drawWindowPage(doc, w, report, pitchOverride)

    doc.end()
  })
}

/** Nome de arquivo seguro pro download. */
export function pdfFilename(report: RaioXReport): string {
  const f = report.funil === 'all' ? 'todos' : report.funil.replace(/[^a-z0-9]/gi, '')
  return `raio-x-escala-${f}-${report.geradoEmBR}.pdf`
}
