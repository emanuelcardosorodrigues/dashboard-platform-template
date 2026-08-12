/**
 * Saúde dos dados do Orgânico — honestidade na superfície: status de cada
 * conta conectada, lag conhecido das APIs e o que ainda não existe.
 * Server component (recebe contas já buscadas).
 */
import Link from 'next/link'
import type { OrganicAccount } from '@/lib/organico/queries'

const PLATFORM_LABEL: Record<string, string> = {
  youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok',
}

export default function OrganicDataHealth({ accounts }: { accounts: OrganicAccount[] }) {
  return (
    <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Saúde dos dados</h3>
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => {
          const ok = a.status === 'active' && !a.last_error
          const expired = a.status === 'token_expired'
          return (
            <span key={a.id} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
              expired ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : ok ? 'border-emerald-500/20 bg-emerald-500/5 text-gray-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${expired ? 'bg-rose-400' : ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {PLATFORM_LABEL[a.platform] ?? a.platform} · {a.handle ?? a.external_id}
              {expired && <Link href="/admin/projetos" className="underline">reconectar</Link>}
              {!expired && a.last_sync_at && (
                <span className="text-gray-500">sync {new Date(a.last_sync_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </span>
          )
        })}
        <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> TikTok · aguardando aprovação do app
        </span>
      </div>
      <p className="text-[11px] text-gray-600 mt-2">
        YouTube Analytics tem defasagem oficial de 48–72h. Stories do Instagram são coletados a cada 3h enquanto vivos.
        Métrica ausente aparece como &quot;—&quot; (nunca zero no lugar de dado que a API não retornou).
      </p>
    </div>
  )
}
