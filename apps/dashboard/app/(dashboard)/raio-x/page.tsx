export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Header from '@/components/layout/Header'
import { buildRaioX } from '@/lib/raioX'
import { listPlayers, type VturbPlayer } from '@/lib/vturb'
import RaioXClient from './RaioXClient'

interface SearchParamsShape {
  funil?: string
  conta?: string
  players?: string
}

export default async function RaioXPage({ searchParams }: { searchParams: Promise<SearchParamsShape> }) {
  const { funil = 'all', conta = 'all', players: playersArg = '' } = await searchParams
  return (
    <div className="flex flex-col h-full">
      <Header title="Raio-X da Escala" subtitle="Relatório consolidado 30 / 15 / 7 dias" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Suspense fallback={<div className="glass-panel rounded-[20px] h-96 animate-pulse" />}>
          <RaioXContent funil={funil} conta={conta} playersArg={playersArg} />
        </Suspense>
      </div>
    </div>
  )
}

async function RaioXContent({ funil, conta, playersArg }: { funil: string; conta: string; playersArg: string }) {
  const [report, playersList] = await Promise.all([
    buildRaioX({ funil, conta, playersArg }),
    listPlayersSafe(),
  ])

  return (
    <RaioXClient
      report={report}
      players={playersList}
      selectedPlayerIds={report.playerIds}
    />
  )
}

async function listPlayersSafe(): Promise<VturbPlayer[]> {
  if (!process.env.VTURB_API_TOKEN) return []
  try {
    return await listPlayers()
  } catch {
    return []
  }
}

