import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { listCriativos } from '@/lib/criativos'

export const dynamic = 'force-dynamic'

// Respeita os filtros globais do dashboard: de/ate (data), funil, conta.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const de = sp.get('de') ?? ''
  const ate = sp.get('ate') ?? ''
  const funil = sp.get('funil') ?? 'all'
  const conta = sp.get('conta') ?? 'all'

  try {
    const criativos = await listCriativos(de, ate, funil, conta)
    return NextResponse.json({ criativos, total: criativos.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'erro ao listar criativos', criativos: [], total: 0 },
      { status: 500 }
    )
  }
}
