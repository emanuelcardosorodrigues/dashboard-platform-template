export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { ArrowLeft, Megaphone, FolderOpen, Clock } from 'lucide-react'
import Header from '@/components/layout/Header'
import { getActiveWorkspaceId } from '@/lib/workspace-context'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

interface AnaliseRow {
  ad_id: string
  ad_name: string | null
  thumbnail_url: string | null
  fonte: string | null
  hook_tipo: string | null
  formato_visual: string | null
  resumo: string | null
  status: string | null
}
interface InvRow { fonte: string | null; analisado: boolean }

const FONTE_LABEL: Record<string, string> = { anuncio: 'Anúncio (0 entrega)', biblioteca: 'Biblioteca' }

export default async function NaoRodaramPage() {
  const ws = await getActiveWorkspaceId()
  const sb = db()
  const [{ data: analisadosRaw }, { data: invRaw }] = await Promise.all([
    sb.from('criativo_analise')
      .select('ad_id, ad_name, thumbnail_url, fonte, hook_tipo, formato_visual, resumo, status')
      .eq('workspace_id', ws).eq('rodou', false)
      .order('gerado_at', { ascending: false, nullsFirst: false }) as unknown as Promise<{ data: AnaliseRow[] | null }>,
    sb.from('criativo_biblioteca').select('fonte, analisado').eq('workspace_id', ws) as unknown as Promise<{ data: InvRow[] | null }>,
  ])
  const analisados = (analisadosRaw ?? []).filter((a) => a.status === 'ok')
  const inv = invRaw ?? []
  const total = inv.length
  const pendentes = inv.filter((i) => !i.analisado).length
  const adsZerados = inv.filter((i) => i.fonte === 'anuncio').length
  const assetsSoltos = inv.filter((i) => i.fonte === 'biblioteca').length

  return (
    <div className="flex flex-col h-full">
      <Header title="Criativos que não rodaram" subtitle="Banco criativo · sem entrega · classificado por conteúdo" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Link href="/criativos-ia" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white">
          <ArrowLeft size={14} /> Voltar pra Análise de Criativos
        </Link>

        {/* Resumo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat icon={<FolderOpen size={15} />} label="Total no banco" value={total} />
          <Stat icon={<Megaphone size={15} />} label="Anúncios 0-entrega" value={adsZerados} />
          <Stat icon={<FolderOpen size={15} />} label="Assets soltos" value={assetsSoltos} />
          <Stat icon={<Clock size={15} />} label="Na fila de análise" value={pendentes} accent="text-amber-300" />
        </div>

        {total === 0 && (
          <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center text-sm text-gray-400">
            Inventário ainda vazio. Rode <code className="text-gray-300">/api/criativos/biblioteca/sync</code> (cron diário 09:55) pra mapear o que está parado na conta.
          </div>
        )}
        {total > 0 && pendentes > 0 && (
          <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
            {pendentes} criativo(s) na fila — a análise roda automática no cron diário (custo zero: Whisper local + Gemini free tier, cap por run). Os já classificados aparecem abaixo.
          </div>
        )}

        {/* Grid de classificados */}
        {analisados.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {analisados.map((a) => (
              <div key={a.ad_id} className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden flex flex-col">
                <div className="aspect-video bg-[#0A0F1E] relative">
                  {a.thumbnail_url
                    ? <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${a.thumbnail_url})` }} />
                    : <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">sem thumbnail</div>}
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-medium bg-black/60 text-gray-200">
                    {FONTE_LABEL[a.fonte ?? ''] ?? a.fonte}
                  </span>
                </div>
                <div className="p-4 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-white leading-tight line-clamp-1">{a.ad_name || a.ad_id}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {a.hook_tipo && <Chip>{a.hook_tipo}</Chip>}
                    {a.formato_visual && <Chip>{a.formato_visual}</Chip>}
                  </div>
                  {a.resumo && <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">{a.resumo}</p>}
                  <p className="text-[10px] text-gray-600 mt-1">sem ROAS/CPA — não rodou</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: string }) {
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-gray-500 mb-2">{icon}<span className="text-xs uppercase tracking-wider">{label}</span></div>
      <p className={`text-2xl font-bold ${accent ?? 'text-white'}`}>{value}</p>
    </div>
  )
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-md text-[10px] bg-[#1F2937] text-gray-300">{children}</span>
}
