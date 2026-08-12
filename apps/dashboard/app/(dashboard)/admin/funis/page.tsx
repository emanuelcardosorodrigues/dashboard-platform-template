export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import Header from '@/components/layout/Header'
import { getActiveWorkspaceId } from '@/lib/workspace-context'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import FunisAdminClient, { type FunilRow } from './FunisAdminClient'

async function requireAdmin() {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  const session = sessionId ? await lookupSession(sessionId) : null
  if (!session || session.role !== 'admin') redirect('/visao-geral')
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function fetchFunisRaw(ws: string): Promise<FunilRow[]> {
  const { data } = await db()
    .from('funis')
    .select('id,nome,slug,ordem,ativo,cor,produtos,campanhas')
    .eq('workspace_id', ws)
    .order('ordem') as { data: FunilRow[] | null }
  return data ?? []
}

// Produtos distintos das transações — alimenta os autocompletes do editor de regras.
// Duas listas: nomes (regra legada) e IDs Hotmart com o nome como rótulo (regra
// preferida — o ID não muda quando o produto é renomeado no painel).
async function fetchProdutos(ws: string): Promise<{ nomes: string[]; ids: { id: string; nome: string }[] }> {
  const { data } = await db()
    .from('transacoes')
    .select('produto,produto_id')
    .eq('workspace_id', ws)
    .gt('valor_bruto', 1)
    .order('data', { ascending: false })
    .limit(3000) as { data: Array<{ produto: string | null; produto_id: string | null }> | null }
  const nomes = new Set<string>()
  // Primeiro nome visto por ID = o mais recente (query ordenada por data desc),
  // então um produto renomeado aparece com o nome ATUAL, não com o antigo.
  const porId = new Map<string, string>()
  for (const r of data ?? []) {
    if (r.produto) nomes.add(r.produto)
    if (r.produto_id && !porId.has(r.produto_id)) porId.set(r.produto_id, r.produto || r.produto_id)
  }
  return {
    nomes: [...nomes].sort(),
    ids: [...porId].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome)),
  }
}

export default async function FunisAdminPage() {
  await requireAdmin()
  const ws = await getActiveWorkspaceId()
  const [funis, produtos] = await Promise.all([fetchFunisRaw(ws), fetchProdutos(ws)])
  return (
    <div className="flex flex-col h-full">
      <Header title="Funis" subtitle="Defina os produtos (papel) e as campanhas de cada filtro" />
      <div className="flex-1 overflow-y-auto p-6">
        <FunisAdminClient funisIniciais={funis} produtosDisponiveis={produtos.nomes} produtosIds={produtos.ids} />
      </div>
    </div>
  )
}
