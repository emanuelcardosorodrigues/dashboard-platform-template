import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import QRCode from 'qrcode'

const VERIFICACAO_URL = 'https://nfse.example.com/validar'

async function qrPngBytes(url) {
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 200 })
  const base64  = dataUrl.split(',')[1]
  const bin     = atob(base64)
  const bytes   = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const CINZA = rgb(0.35, 0.35, 0.35)
const PRETO = rgb(0.1, 0.1, 0.1)
const AZUL  = rgb(0.05, 0.35, 0.6)

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))
  return m ? m[1].trim() : ''
}

function fmtBRL(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  if (!isFinite(n)) return 'R$ 0,00'
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDoc(d) {
  const x = String(d ?? '').replace(/\D/g, '')
  if (x.length === 11) return `${x.slice(0,3)}.${x.slice(3,6)}.${x.slice(6,9)}-${x.slice(9)}`
  if (x.length === 14) return `${x.slice(0,2)}.${x.slice(2,5)}.${x.slice(5,8)}/${x.slice(8,12)}-${x.slice(12)}`
  return d ?? '—'
}

function fmtData(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${mi}`
}

function safeText(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/[^\x20-\x7E -ÿ]/g, '?')
}

function quebrarLinha(texto, font, size, max) {
  const palavras = String(texto ?? '').split(/\s+/)
  const linhas = []
  let atual = ''
  for (const p of palavras) {
    const teste = atual ? `${atual} ${p}` : p
    if (font.widthOfTextAtSize(teste, size) <= max) atual = teste
    else { if (atual) linhas.push(atual); atual = p }
  }
  if (atual) linhas.push(atual)
  return linhas
}

export async function gerarDanfsePdf({ xml, nota, produto, env = {} }) {
  const verificationUrl = env.NFSE_VERIFICATION_URL || VERIFICACAO_URL
  const issuerName = env.NFSE_PROVIDER_NAME || 'PRESTADOR CONFIGURÁVEL'
  const issuerCnpj = env.NFSE_PROVIDER_CNPJ || '00000000000000'
  const issuerIm = env.NFSE_PROVIDER_MUNICIPAL_REGISTRATION || '0000000'
  const issuerCity = env.NFSE_PROVIDER_CITY || 'Município Exemplo / UF'
  const numeroNfse        = nota.numero_nfse ?? tag(xml, 'Numero')
  const codigoVerificacao = tag(xml, 'CodigoVerificacao')
  const dataEmissao       = tag(xml, 'DataEmissao') || nota.criado_em
  const valorServicos     = tag(xml, 'ValorServicos') || nota.valor
  const discriminacao     = safeText(tag(xml, 'Discriminacao') || `${produto?.nome ?? ''}`)
  const competencia       = tag(xml, 'Competencia')
  const codigoServico     = tag(xml, 'ItemListaServico') || '0802'
  const codigoMunicipio   = tag(xml, 'CodigoMunicipio')  || (env.NFSE_MUNICIPALITY_CODE || '0000000')
  const aliquota          = tag(xml, 'Aliquota')
  const chaveAcesso       = (tag(xml, 'OutrasInformacoes').match(/\d{40,}/) ?? [''])[0]

  const doc      = await PDFDocument.create()
  const page     = doc.addPage([595.28, 841.89]) // A4
  const fontReg  = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = page.getWidth()
  const M = 36
  let y   = page.getHeight() - M

  function linha(yPos) {
    page.drawLine({ start: { x: M, y: yPos }, end: { x: W - M, y: yPos }, thickness: 0.6, color: CINZA })
  }
  function texto(s, x, yPos, { size = 9, bold = false, color = PRETO } = {}) {
    page.drawText(safeText(s), { x, y: yPos, size, font: bold ? fontBold : fontReg, color })
  }
  function box(x, yPos, w, h, fill) {
    page.drawRectangle({ x, y: yPos - h, width: w, height: h, color: fill ?? rgb(0.96, 0.96, 0.96), borderColor: CINZA, borderWidth: 0.5 })
  }

  // Cabeçalho
  box(M, y, W - 2 * M, 56, rgb(0.94, 0.97, 1))
  texto(`Prefeitura Municipal de ${issuerCity}`, M + 10, y - 16, { size: 11, bold: true, color: AZUL })
  texto('NOTA FISCAL DE SERVICOS ELETRONICA - NFS-e', M + 10, y - 32, { size: 10, bold: true })
  texto(`Numero da Nota: ${numeroNfse || '—'}`, M + 10, y - 48, { size: 9 })
  texto(`Data e Hora de Emissao: ${fmtData(dataEmissao)}`, M + 250, y - 48, { size: 9 })
  texto(`Codigo de Verificacao: ${codigoVerificacao || '—'}`, W - M - 200, y - 16, { size: 9, bold: true })
  if (competencia) texto(`Competencia: ${competencia}`, W - M - 200, y - 32, { size: 9 })
  y -= 70

  // Prestador
  texto('PRESTADOR DE SERVICOS', M, y, { size: 9, bold: true, color: AZUL })
  y -= 4
  linha(y); y -= 14
  texto('Razao Social:', M, y, { size: 8, color: CINZA })
  texto(issuerName, M + 75, y, { size: 9, bold: true })
  y -= 14
  texto('CNPJ:', M, y, { size: 8, color: CINZA })
  texto(fmtDoc(issuerCnpj), M + 75, y, { size: 9 })
  texto('Inscricao Municipal:', M + 250, y, { size: 8, color: CINZA })
  texto(issuerIm, M + 360, y, { size: 9 })
  y -= 14
  texto('Municipio:', M, y, { size: 8, color: CINZA })
  texto(issuerCity, M + 75, y, { size: 9 })
  texto('Regime:', M + 250, y, { size: 8, color: CINZA })
  texto('Simples Nacional ME/EPP', M + 360, y, { size: 9 })
  y -= 22

  // Tomador
  texto('TOMADOR DE SERVICOS', M, y, { size: 9, bold: true, color: AZUL })
  y -= 4
  linha(y); y -= 14
  texto('Nome / Razao Social:', M, y, { size: 8, color: CINZA })
  texto(safeText(nota.nome_tomador ?? '—'), M + 100, y, { size: 9, bold: true })
  y -= 14
  texto('CPF / CNPJ:', M, y, { size: 8, color: CINZA })
  texto(fmtDoc(nota.doc_tomador), M + 100, y, { size: 9 })
  if (nota.email_tomador) {
    texto('E-mail:', M + 280, y, { size: 8, color: CINZA })
    texto(safeText(nota.email_tomador), M + 320, y, { size: 9 })
  }
  y -= 22

  // Serviço
  texto('DISCRIMINACAO DOS SERVICOS', M, y, { size: 9, bold: true, color: AZUL })
  y -= 4
  linha(y); y -= 14
  if (produto?.nome) {
    texto('Produto:', M, y, { size: 8, color: CINZA })
    texto(safeText(produto.nome), M + 75, y, { size: 9 })
    y -= 14
  }
  texto('Codigo do Servico:', M, y, { size: 8, color: CINZA })
  texto(`${codigoServico} - Servicos de instrucao, treinamento, orientacao pedagogica`, M + 95, y, { size: 9 })
  y -= 14
  texto('Municipio de Incidencia:', M, y, { size: 8, color: CINZA })
  texto(`${codigoMunicipio} - ${issuerCity}`, M + 120, y, { size: 9 })
  y -= 16

  // Discriminação multilinha
  const linhasDescricao = quebrarLinha(discriminacao, fontReg, 9, W - 2 * M - 10)
  for (const ln of linhasDescricao) {
    texto(ln, M + 5, y, { size: 9 })
    y -= 12
  }
  y -= 10

  // Valores
  const vNum = typeof valorServicos === 'number' ? valorServicos : parseFloat(String(valorServicos).replace(',', '.'))
  const aliqNum = parseFloat(String(aliquota || '2').replace(',', '.'))
  const issQtl  = isFinite(vNum) && isFinite(aliqNum) ? vNum * aliqNum / 100 : 0
  const liquido = isFinite(vNum) ? vNum : 0

  texto('VALORES', M, y, { size: 9, bold: true, color: AZUL })
  y -= 4
  linha(y); y -= 16
  box(M, y, W - 2 * M, 50, rgb(0.98, 0.98, 0.98))
  texto('Valor dos Servicos', M + 10, y - 14, { size: 8, color: CINZA })
  texto(fmtBRL(vNum), M + 10, y - 28, { size: 11, bold: true })
  texto(`Aliquota ISS: ${aliqNum.toFixed(2)}%`, M + 10, y - 42, { size: 8, color: CINZA })

  texto('Valor do ISS', M + 200, y - 14, { size: 8, color: CINZA })
  texto(fmtBRL(issQtl), M + 200, y - 28, { size: 10, bold: true })

  texto('Valor Liquido', W - M - 130, y - 14, { size: 8, color: CINZA })
  texto(fmtBRL(liquido), W - M - 130, y - 28, { size: 12, bold: true, color: AZUL })
  y -= 64

  // Validação
  texto('VALIDACAO', M, y, { size: 9, bold: true, color: AZUL })
  y -= 4
  linha(y); y -= 14

  const qrUrl = `${verificationUrl}?numero=${encodeURIComponent(numeroNfse || '')}&codigo=${encodeURIComponent(codigoVerificacao || '')}&cnpj=${encodeURIComponent(issuerCnpj)}`
  let qrEmbed = null
  try {
    const qrBytes = await qrPngBytes(qrUrl)
    qrEmbed = await doc.embedPng(qrBytes)
  } catch (e) {
    console.warn('[pdf] falha ao gerar QR code:', e?.message)
  }

  const QR_SIZE = 90
  const textoMaxX = qrEmbed ? W - M - QR_SIZE - 12 : W - M

  texto('Para validar a autenticidade desta nota, acesse:', M, y, { size: 9 })
  y -= 14
  texto(verificationUrl, M, y, { size: 9, color: AZUL })
  y -= 14
  texto(`Numero: ${numeroNfse || '—'}    Codigo de Verificacao: ${codigoVerificacao || '—'}    CNPJ Prestador: ${fmtDoc(issuerCnpj)}`, M, y, { size: 8, color: CINZA })
  if (chaveAcesso) {
    y -= 14
    texto(`Chave de Acesso NFS-e Nacional: ${chaveAcesso}`, M, y, { size: 7, color: CINZA })
  }

  if (qrEmbed) {
    page.drawImage(qrEmbed, { x: textoMaxX + 4, y: y - 8, width: QR_SIZE, height: QR_SIZE })
    texto('Aponte a câmera para validar', textoMaxX + 4, y - QR_SIZE - 4, { size: 7, color: CINZA })
  }

  // Rodapé
  const rodape = nota.status === 'cancelada' || nota.status === 'cancelada-drive-pending'
    ? 'NOTA CANCELADA'
    : `Documento gerado eletronicamente. NFS-e oficial registrada na Prefeitura Municipal de ${issuerCity}.`
  texto(rodape, M, M, { size: 8, color: nota.status === 'cancelada' ? rgb(0.8, 0.1, 0.1) : CINZA, bold: nota.status === 'cancelada' })

  if (nota.status === 'cancelada' || nota.status === 'cancelada-drive-pending') {
    page.drawText('CANCELADA', {
      x: 130, y: 380, size: 80, font: fontBold,
      color: rgb(0.85, 0.1, 0.1), opacity: 0.18, rotate: { type: 'degrees', angle: 30 },
    })
  }

  return await doc.save()
}
