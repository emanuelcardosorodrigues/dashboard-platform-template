import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { ShieldCheck, AlertTriangle, Plus } from 'lucide-react'
import { listConfiguredProviders } from '@/lib/integrations/credentials'
import { PROVIDER_ORDER } from '@/lib/integrations/providers'
import { credentialsEncryptionReady } from '@/lib/crypto/secrets'

export const dynamic = 'force-dynamic'

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

interface Ws { id: string; slug: string; nome: string }

export default async function ProjetosPage() {
  const { data } = await db().from('workspaces').select('id, slug, nome').order('nome')
  const workspaces = (data ?? []) as Ws[]
  const configured = await Promise.all(
    workspaces.map((w) => listConfiguredProviders(w.id).then((c) => c.map((x) => x.provider))),
  )
  const total = PROVIDER_ORDER.length
  const keyOk = credentialsEncryptionReady()

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-xl font-bold text-white">Projetos &amp; Credenciais</h1>
        <Link href="/admin/projetos/novo" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shrink-0">
          <Plus size={14} /> Novo projeto
        </Link>
      </div>
      <p className="text-sm text-gray-400 mb-5">
        Cada projeto tem suas próprias integrações. As credenciais são guardadas <strong className="text-gray-200">cifradas</strong> (AES-256-GCM) e nunca exibidas de volta.
      </p>

      {!keyOk && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          <AlertTriangle size={15} /> Master key de credenciais ausente — configure <code>CREDENTIALS_MASTER_KEY</code> antes de salvar segredos.
        </div>
      )}

      <div className="space-y-2">
        {workspaces.map((w, i) => {
          const n = configured[i].length
          return (
            <Link
              key={w.id}
              href={`/admin/projetos/${w.id}`}
              className="flex items-center justify-between rounded-lg border border-[#1F2937] bg-[#0F172A] px-4 py-3 hover:border-[#2b3a55] transition-colors"
            >
              <div>
                <div className="text-white font-medium">{w.nome}</div>
                <div className="text-xs text-gray-500 font-mono">{w.slug}</div>
              </div>
              <div className={`flex items-center gap-2 text-sm tabular-nums ${n === total ? 'text-emerald-400' : n > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
                <ShieldCheck size={15} /> {n}/{total} integrações
              </div>
            </Link>
          )
        })}
        {workspaces.length === 0 && <p className="text-sm text-gray-500">Nenhum projeto ainda.</p>}
      </div>
    </div>
  )
}
