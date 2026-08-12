/**
 * /organico/tiktok — shell honesto enquanto o app na TikTok for Business
 * aguarda aprovação (~2-4 semanas). A página já existe pra navegação ficar
 * completa; vira a área dedicada (FYP%, completion, funil de perfil) quando
 * a Onda TikTok ligar.
 */
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { Hourglass } from 'lucide-react'
import { fetchOrganicAccounts } from '@/lib/organico/queries'

export const dynamic = 'force-dynamic'

export default async function OrganicoTiktokPage() {
  const accounts = await fetchOrganicAccounts('tiktok')

  return (
    <div className="flex flex-col h-full">
      <Header title="TikTok — Orgânico" subtitle="Distribuição FYP, completion e funil de perfil" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="rounded-xl border border-[#1F2937] bg-[#111827] p-10 max-w-2xl mx-auto mt-10 text-center">
          <Hourglass size={28} className="mx-auto text-cyan-400 mb-3" />
          <h2 className="text-white font-semibold mb-2">
            {accounts.length > 0 ? 'Conta conectada — aguardando primeiro sync' : 'Aguardando aprovação do app na TikTok for Business'}
          </h2>
          <p className="text-sm text-gray-400 mb-5">
            A revisão do TikTok leva ~2-4 semanas. Assim que aprovar, esta área liga com os dados
            que só o TikTok entrega por vídeo:
          </p>
          <div className="grid sm:grid-cols-2 gap-2 text-left text-xs text-gray-400 max-w-lg mx-auto mb-6">
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">% de views vindas do <b className="text-gray-200">For You</b> (por vídeo)</div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2"><b className="text-gray-200">Completion rate</b> e watch time médio</div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">Funil <b className="text-gray-200">views → perfil → follows</b></div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">Saúde de distribuição (queda de FYP = sinal de shadowban)</div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">Seguidores ganho/perda por dia (janela de 60d arquivada)</div>
            <div className="rounded-md border border-white/5 bg-white/[0.03] px-3 py-2">Demografia + horários de atividade da audiência</div>
          </div>
          <p className="text-[11px] text-gray-600">
            Importante: a janela de dados do TikTok é de só 60 dias — por isso a conexão entra no ar assim que o app for aprovado.
          </p>
          <Link href="/organico/conteudo" className="inline-flex mt-4 rounded-md bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm text-white">
            ← Voltar pra Análise de Conteúdo
          </Link>
        </div>
      </div>
    </div>
  )
}
