import { NextRequest, NextResponse } from 'next/server'
import { buildRaioX } from '@/lib/raioX'
import { renderRaioXPdf, pdfFilename } from '@/lib/pdfRaioX'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/raio-x/pdf?funil=plo&conta=all&players=id1,id2&pitch=1920
 *  - funil  : filtro do dashboard (all|col-|dpl-|plo|lps-)
 *  - conta  : id da conta Meta ou 'all'
 *  - players: csv de player ids da vTurb, 'all', ou vazio (omite VSL)
 *  - pitch  : tempo do pitch em segundos (override manual); vazio = auto vTurb
 *
 * Stream do PDF como application/pdf com Content-Disposition: attachment.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const funil = searchParams.get('funil') ?? 'all'
  const conta = searchParams.get('conta') ?? 'all'
  const playersArg = searchParams.get('players') ?? ''
  const pitchRaw = searchParams.get('pitch')
  const pitchParsed = pitchRaw != null ? Number(pitchRaw) : NaN
  const pitchOverride = Number.isFinite(pitchParsed) && pitchParsed >= 0 ? pitchParsed : null

  try {
    const report = await buildRaioX({ funil, conta, playersArg })
    const pdf = await renderRaioXPdf(report, pitchOverride)
    const filename = pdfFilename(report)

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': pdf.byteLength.toString(),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
