import { NextRequest, NextResponse } from 'next/server'
import { parseBody, badRequest, nfseEmitirSchema } from '@/lib/validation/schemas'
import { readWorkerJson } from '@/lib/nfse/workerResponse'

const WORKER_URL = process.env.NFSE_WORKER_URL!
const API_KEY    = process.env.NFSE_API_KEY!

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, nfseEmitirSchema)
  if (!parsed.ok) {
    const r = badRequest(parsed)
    return NextResponse.json(r.body, { status: r.status })
  }
  const res  = await fetch(`${WORKER_URL}/emitir`, {
    method:  'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify(parsed.data),
  })
  const { data, status } = await readWorkerJson(res)
  return NextResponse.json(data, { status })
}
