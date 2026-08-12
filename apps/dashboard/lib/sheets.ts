import { google } from 'googleapis'
import { unstable_cache } from 'next/cache'

const SPREADSHEET_ID = (process.env.SPREADSHEET_ID ?? '').trim()

function isConfigured(): boolean {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const key = process.env.GOOGLE_PRIVATE_KEY ?? ''
  return (
    email.length > 0 &&
    !email.toLowerCase().includes('placeholder') &&
    key.length > 0 &&
    !key.includes('PLACEHOLDER') &&
    SPREADSHEET_ID.length > 0
  )
}

async function _fetchSheetRange(range: string): Promise<string[][]> {
  if (!isConfigured()) {
    return []
  }
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim(),
        private_key: process.env.GOOGLE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const authClient = await auth.getClient()
    const sheets = google.sheets({ version: 'v4', auth: authClient as Parameters<typeof google.sheets>[0]['auth'] })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range,
    })
    return (res.data.values as string[][]) ?? []
  } catch (err) {
    console.error(`[sheets] Error fetching range "${range}":`, err)
    return []
  }
}

// Cache each range for 30 minutes
export const fetchSheetRange = unstable_cache(
  _fetchSheetRange,
  ['sheets-range'],
  { revalidate: 1800, tags: ['sheets'] }
)

// ─── Sheet-specific fetchers ──────────────────────────────────────────────────

export const fetchTransacoes = () =>
  fetchSheetRange("'TODAS AS TRANSAÇÕES'!A1:AM3000")

export const fetchMetricasCampanhas = () =>
  fetchSheetRange("'Métricas das Campanhas Dia a Di'!A1:AE1100")

export const fetchDadosMetaAds = () =>
  fetchSheetRange("'Dados do Meta Ads'!A1:AO15000")

export const fetchLucroFaturamentoDiario = () =>
  fetchSheetRange("'Lucro e Faturamento Diário'!A1:AB200")

export const fetchTotais = () =>
  fetchSheetRange("'Totais'!A1:Z2")

export const fetchQualificacaoCompradores = () =>
  fetchSheetRange("'_Qualificação Compradores'!A1:AK800")

export const fetchCriativosAnalise = () =>
  fetchSheetRange("'_Criativos Análise'!A1:AP60")

export const fetchCanaisUltimoToque = () =>
  fetchSheetRange("'_Canais Último Toque'!A1:Z20")

export const fetchPrimeiroImpacto = () =>
  fetchSheetRange("'_Primeiro Impacto Análise'!A1:Z15")

export const fetchMentoriaAlunos = () =>
  fetchSheetRange("'_Mentoria Alunos'!A1:Z10")

export const fetchCriativosLinks = () =>
  fetchSheetRange("'Métricas das Campanhas Dia a Di'!F:G")

// ─── Row parsers ──────────────────────────────────────────────────────────────

function normalizeKey(k: string): string {
  return k.trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
}

export function headersToIndex(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  headers.forEach((h, i) => {
    const trimmed = h.trim()
    result[trimmed] = i
    result[normalizeKey(trimmed)] = i
  })
  return result
}

export function getCell(row: string[], index: number): string {
  return (row[index] ?? '').toString().trim()
}
