/**
 * Proxy de transcrição de ALTA QUALIDADE: recebe um arquivo de áudio (multipart)
 * da VPS e encaminha para whisper-large-v3 num provedor de GPU — qualidade de
 * ponta, ZERO RAM da VPS, sem OOM. As chaves ficam SÓ aqui (Vercel); a VPS nunca
 * as vê. Usado pelo worker transcrever_organico.py e por processar_criativos.py.
 *
 * Cadeia de provedores (cai pro próximo em erro/429):
 *   1. DeepInfra  whisper-large-v3 (pago, barato, sem fila)   ← principal
 *   2. Groq       whisper-large-v3 (free tier, rate-limit)     ← backup
 *
 * Entrada: POST multipart { file: <audio>, language?: 'pt' }
 * Saída:   { text, model } | { error }
 */
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

interface Provider {
  name: string
  url: string
  key: string | undefined
  model: string
}

// Ordem = prioridade. Só entra na cadeia quem tem chave configurada na Vercel.
function providers(): Provider[] {
  return [
    { name: 'deepinfra-whisper-large-v3', url: 'https://api.deepinfra.com/v1/openai/audio/transcriptions', key: process.env.DEEPINFRA_API_KEY, model: 'openai/whisper-large-v3' },
    { name: 'groq-whisper-large-v3', url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: process.env.GROQ_API_KEY, model: process.env.GROQ_WHISPER_MODEL ?? 'whisper-large-v3' },
  ].filter((p) => !!p.key)
}

function authOk(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true
  const s = process.env.CRON_SECRET
  return !!s && req.headers.get('authorization') === `Bearer ${s}`
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chain = providers()
  if (chain.length === 0) return NextResponse.json({ error: 'nenhum provedor configurado (DEEPINFRA_API_KEY/GROQ_API_KEY)' }, { status: 503 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart inválido' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'campo file ausente' }, { status: 400 })
  const language = (form.get('language') as string | null) || 'pt'
  const bytes = Buffer.from(await file.arrayBuffer()) // lê uma vez; recria Blob por tentativa

  let lastErr = 'sem tentativa'
  let lastStatus = 502
  for (const p of chain) {
    const fd = new FormData()
    fd.append('file', new Blob([bytes]), 'audio.mp3')
    fd.append('model', p.model)
    fd.append('language', language)
    fd.append('response_format', 'json')
    fd.append('temperature', '0')
    let resp: Response
    try {
      resp = await fetch(p.url, { method: 'POST', headers: { Authorization: `Bearer ${p.key}` }, body: fd })
    } catch (e) {
      lastErr = `${p.name}: ${String((e as Error)?.message ?? e)}`
      continue
    }
    const body = await resp.text()
    if (!resp.ok) {
      lastErr = `${p.name} ${resp.status}: ${body.slice(0, 200)}`
      lastStatus = resp.status === 429 ? 429 : 502
      // 429 ou 5xx -> tenta o próximo provedor da cadeia
      continue
    }
    let text = ''
    try { text = (JSON.parse(body) as { text?: string }).text ?? '' } catch { text = body }
    if (text.trim()) return NextResponse.json({ text: text.trim(), model: p.name })
    lastErr = `${p.name}: resposta vazia`
  }
  return NextResponse.json({ error: lastErr }, { status: lastStatus })
}
