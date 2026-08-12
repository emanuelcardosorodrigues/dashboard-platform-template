import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DASHBOARD_PATHS } from '@/lib/auth'
import { createUserAction } from '../actions'

const ERROR_MESSAGES: Record<string, string> = {
  email: 'E-mail inválido.',
  duplicate: 'Já existe um usuário com este e-mail.',
  db: 'Erro ao salvar no banco.',
}

export default async function NewAdminUserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string }>
}) {
  const { error, msg } = await searchParams
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Erro desconhecido.') : null

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center px-6 shrink-0 gap-4">
        <Link
          href="/admin"
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={14} /> Voltar
        </Link>
        <div className="border-l border-[#1F2937] h-6" />
        <div>
          <h1 className="text-lg font-semibold text-white font-[family-name:var(--font-heading)]">
            Novo usuário
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Senha temporária gerada na criação</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl">
          {errorMessage && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
              {errorMessage}
              {msg && <span className="block text-xs text-rose-400/80 mt-1">{decodeURIComponent(msg)}</span>}
            </div>
          )}

          <form action={createUserAction} className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-300 mb-1.5">
                E-mail <span className="text-rose-400">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="off"
                className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-cyan-500/50"
                placeholder="usuario@empresa.com"
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-xs font-medium text-gray-300 mb-1.5">
                Nome
              </label>
              <input
                id="name"
                name="name"
                type="text"
                maxLength={120}
                className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-cyan-500/50"
                placeholder="João Silva"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Papel</label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-start gap-2 p-3 rounded-lg border border-[#1F2937] bg-[#0A0F1E] cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                  <input type="radio" name="role" value="viewer" defaultChecked className="mt-0.5 accent-cyan-500" />
                  <span>
                    <span className="block text-sm text-white font-medium">Viewer</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">Acesso restrito ao allowlist + IA com cota</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-[#1F2937] bg-[#0A0F1E] cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                  <input type="radio" name="role" value="admin" className="mt-0.5 accent-cyan-500" />
                  <span>
                    <span className="block text-sm text-white font-medium">Admin</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">Acesso total e gestão de usuários</span>
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Allowlist inicial</label>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex items-start gap-2 p-3 rounded-lg border border-[#1F2937] bg-[#0A0F1E] cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                  <input type="radio" name="preset" value="basico" defaultChecked className="mt-0.5 accent-cyan-500" />
                  <span>
                    <span className="block text-sm text-white font-medium">Básico</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">5 telas (visão, criativos, campanhas, funil, financeiro)</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-[#1F2937] bg-[#0A0F1E] cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                  <input type="radio" name="preset" value="todas" className="mt-0.5 accent-cyan-500" />
                  <span>
                    <span className="block text-sm text-white font-medium">Todas</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">{DASHBOARD_PATHS.length} abas do dashboard</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 p-3 rounded-lg border border-[#1F2937] bg-[#0A0F1E] cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                  <input type="radio" name="preset" value="vazio" className="mt-0.5 accent-cyan-500" />
                  <span>
                    <span className="block text-sm text-white font-medium">Vazio</span>
                    <span className="block text-[11px] text-gray-500 mt-0.5">Configurar depois no perfil</span>
                  </span>
                </label>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">Admin sempre acessa tudo. Preset só impacta usuários viewer e pode ser editado depois.</p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
              >
                Criar usuário
              </button>
              <Link
                href="/admin"
                className="px-4 py-2 rounded-lg border border-[#1F2937] text-gray-400 text-sm hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
