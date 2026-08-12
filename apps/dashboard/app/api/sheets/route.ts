import { NextRequest, NextResponse } from 'next/server'
import { fetchSheetRange } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') ?? 'Totais!A1:Z2'

  try {
    const data = await fetchSheetRange(range)
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ data: null, error: String(e) }, { status: 500 })
  }
}
