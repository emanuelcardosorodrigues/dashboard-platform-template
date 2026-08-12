export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import SaudeTrafegoClient from './SaudeTrafegoClient'
import { fetchBotUids } from '@/lib/supabase'
import { daysAgoBR, todayBR } from '@/lib/formatters'

type Search = Promise<{ de?: string; ate?: string }>

export default async function SaudeTrafegoPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  // O Header (global) sempre mostra o filtro de data + funil, mas esta rota não
  // tem dimensão de funil nos dados (bot_fingerprints só tem ua/ip/score/país/
  // idioma/referer/captured_at) — por isso só o filtro de DATA é aplicado aqui.
  // O filtro de funil, embora visível no cabeçalho, não se aplica a esta página.
  const de = sp.de || daysAgoBR(30)
  const ate = sp.ate || todayBR()

  return (
    <div className="flex flex-col h-full">
      <Header title="Saúde do Tráfego" subtitle="Bot fingerprints capturados pela rota /r/probe" />
      <div className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<div className="bg-[#111827] border border-[#1F2937] rounded-xl h-64 animate-pulse" />}>
          <SaudeTrafegoContent de={de} ate={ate} />
        </Suspense>
      </div>
    </div>
  )
}

async function SaudeTrafegoContent({ de, ate }: { de: string; ate: string }) {
  const [res, botUids] = await Promise.all([
    fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/bots`, {
      cache: 'no-store',
    }).catch(() => null),
    fetchBotUids(),
  ])

  // Diferencia falha de busca (fetch rejeitado ou status não-ok) de "sem registros"
  // de verdade — antes os dois casos caíam no mesmo array vazio e a UI mentia
  // dizendo "sem registros" quando na real o /api/bots tinha falhado.
  const fetchFailed = !res || !res.ok

  const allRows: Array<{
    ua: string
    ip: string
    cf_bot_score: number | null
    cf_country: string
    accept_language: string
    referer: string
    captured_at: string
  }> = fetchFailed ? [] : await res!.json()

  // Filtro de data (captured_at é datetime ISO; comparação lexicográfica com
  // de/ate em YYYY-MM-DD funciona pois os 10 primeiros chars já são a data).
  const rows = allRows.filter((r) => {
    const day = r.captured_at?.slice(0, 10)
    if (!day) return true
    if (de && day < de) return false
    if (ate && day > ate) return false
    return true
  })

  // Agrupar por UA
  const byUa: Record<string, { count: number; countries: Set<string>; lastSeen: string }> = {}
  for (const r of rows) {
    const key = r.ua || '(sem UA)'
    if (!byUa[key]) byUa[key] = { count: 0, countries: new Set(), lastSeen: r.captured_at }
    byUa[key].count++
    if (r.cf_country) byUa[key].countries.add(r.cf_country)
    if (r.captured_at > byUa[key].lastSeen) byUa[key].lastSeen = r.captured_at
  }

  const uaKeys = Object.keys(byUa)
  const topUas = Object.entries(byUa)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([ua, d]) => ({ ua, count: d.count, countries: [...d.countries].join(', '), lastSeen: d.lastSeen }))

  return (
    <SaudeTrafegoClient
      total={rows.length}
      quarantined={botUids.size}
      uniqueUaCount={uaKeys.length}
      topUas={topUas}
      rows={rows.slice(0, 50)}
      fetchFailed={fetchFailed}
    />
  )
}
