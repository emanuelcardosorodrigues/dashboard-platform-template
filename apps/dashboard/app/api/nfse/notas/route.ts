import { NextRequest, NextResponse } from 'next/server'
import { readWorkerJson } from '@/lib/nfse/workerResponse'

const WORKER_URL = process.env.NFSE_WORKER_URL!
const API_KEY    = process.env.NFSE_API_KEY!

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const qs  = searchParams.toString()
  const res = await fetch(`${WORKER_URL}/api/notas${qs ? `?${qs}` : ''}`, {
    headers: { 'x-api-key': API_KEY },
  })
  const { data, status } = await readWorkerJson(res)
  return NextResponse.json(data, { status })
}
