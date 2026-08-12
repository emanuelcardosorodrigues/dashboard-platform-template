import { NextRequest, NextResponse } from 'next/server'
import { readWorkerJson } from '@/lib/nfse/workerResponse'

const WORKER_URL = process.env.NFSE_WORKER_URL!
const API_KEY    = process.env.NFSE_API_KEY!

function workerHeaders() {
  return { 'x-api-key': API_KEY, 'Content-Type': 'application/json' }
}

export async function GET() {
  const res  = await fetch(`${WORKER_URL}/api/produtos`, { headers: workerHeaders() })
  const { data, status } = await readWorkerJson(res)
  return NextResponse.json(data, { status })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (body == null) return NextResponse.json({ error: 'Body inválido (não-JSON).' }, { status: 400 })
  const res  = await fetch(`${WORKER_URL}/api/produtos`, {
    method:  'POST',
    headers: workerHeaders(),
    body:    JSON.stringify(body),
  })
  const { data, status } = await readWorkerJson(res)
  return NextResponse.json(data, { status })
}

export async function DELETE(req: NextRequest) {
  const product_id = new URL(req.url).searchParams.get('product_id')
  const res   = await fetch(`${WORKER_URL}/api/produtos?product_id=${encodeURIComponent(product_id ?? '')}`, {
    method:  'DELETE',
    headers: workerHeaders(),
  })
  const { data, status } = await readWorkerJson(res)
  return NextResponse.json(data, { status })
}
