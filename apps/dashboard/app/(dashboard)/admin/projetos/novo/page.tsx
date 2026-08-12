import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createWorkspaceAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function NovoProjetoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const erro = sp.erro

  return (
    <div className="p-6 max-w-lg">
      <Link href="/admin/projetos" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-3">
        <ChevronLeft size={15} /> Projetos
      </Link>
      <h1 className="text-xl font-bold text-white mb-1">Novo projeto</h1>
      <p className="text-sm text-gray-400 mb-5">Cria o projeto; em seguida você pluga as credenciais e atribui usuários.</p>

      {erro && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">
          {erro === 'slug_existe' ? 'Já existe um projeto com esse identificador.'
            : erro === 'invalido' ? 'Nome e identificador (slug) são obrigatórios. Slug: minúsculas, números e hífen.'
            : 'Falha ao criar o projeto.'}
        </div>
      )}

      <form action={createWorkspaceAction} className="space-y-3 rounded-xl border border-[#1F2937] bg-[#0F172A] p-4">
        <label className="block">
          <span className="text-xs text-gray-400">Nome do projeto <span className="text-rose-400">*</span></span>
          <input name="nome" required maxLength={120} placeholder="Cliente Acme — Emagrecimento"
            className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">Identificador / slug <span className="text-rose-400">*</span> <span className="text-gray-600">· minúsculas, números, hífen</span></span>
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,30}" placeholder="cli-acme"
            className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white font-mono focus:border-blue-500 outline-none" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-400">URL do logo <span className="text-gray-600">· opcional</span></span>
          <input name="logo_url" maxLength={500} placeholder="https://…/logo.png"
            className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
        </label>
        <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium text-white">
          Criar projeto
        </button>
      </form>
    </div>
  )
}
