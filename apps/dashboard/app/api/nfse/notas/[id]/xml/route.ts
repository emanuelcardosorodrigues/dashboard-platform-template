import { NextRequest, NextResponse } from 'next/server'

const WORKER_URL = process.env.NFSE_WORKER_URL!
const API_KEY    = process.env.NFSE_API_KEY!

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res    = await fetch(`${WORKER_URL}/api/notas/${id}/xml`, {
    headers: { 'x-api-key': API_KEY },
  })
  const text = await res.text()
  return new NextResponse(text, {
    status:  res.status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
