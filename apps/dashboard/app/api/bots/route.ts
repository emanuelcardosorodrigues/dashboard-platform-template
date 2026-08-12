import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const d1Id = process.env.D1_DATABASE_ID
  if (!token || !accountId || !d1Id) {
    return NextResponse.json({ error: 'Cloudflare env vars não configuradas' }, { status: 500 })
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1Id}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT ua, ip, cf_bot_score, cf_country, accept_language, referer,
                     captured_at
              FROM bot_fingerprints
              ORDER BY captured_at DESC
              LIMIT 200`,
      }),
    }
  )

  if (!res.ok) return NextResponse.json({ error: 'Erro ao consultar D1' }, { status: 500 })

  const json = await res.json() as {
    result?: Array<{ results: Array<Record<string, unknown>> }>
    errors?: Array<{ message: string }>
  }

  if (json.errors?.length) {
    return NextResponse.json({ error: json.errors[0].message }, { status: 500 })
  }

  const rows = json.result?.[0]?.results ?? []
  return NextResponse.json(rows)
}
