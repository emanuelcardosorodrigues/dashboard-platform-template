export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { Plus, Shield, Eye, AlertCircle, CheckCircle2, Clock, Pencil, History, FolderLock, Filter } from 'lucide-react'

interface UserRow {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'viewer'
  status: 'active' | 'pending_onboarding' | 'disabled'
  created_at: string
  last_login_at: string | null
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function fetchUsers(): Promise<UserRow[]> {
  const sb = db()
  const { data } = await sb
    .from('users')
    .select('id,email,name,role,status,created_at,last_login_at')
    .order('created_at', { ascending: false }) as { data: UserRow[] | null }
  return data ?? []
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
}

function StatusBadge({ status }: { status: UserRow['status'] }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
        <CheckCircle2 size={11} /> Ativo
      </span>
    )
  }
  if (status === 'pending_onboarding') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
        <Clock size={11} /> Pendente
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-full px-2 py-0.5">
      <AlertCircle size={11} /> Desativado
    </span>
  )
}

function RoleBadge({ role }: { role: UserRow['role'] }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-2 py-0.5">
        <Shield size={11} /> Admin
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
      <Eye size={11} /> Viewer
    </span>
  )
}

export default async function AdminPage() {
  const users = await fetchUsers()

  return (
    <div className="flex flex-col h-full">
      <header className="h-16 bg-[#0A0F1E] border-b border-[#1F2937] flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white font-[family-name:var(--font-heading)]">
            Administração
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Usuários, permissões e quotas de IA</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/projetos"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors"
          >
            <FolderLock size={14} /> Projetos &amp; Credenciais
          </Link>
          <Link
            href="/admin/acoes-meta"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors"
          >
            <History size={14} /> Ações no Meta
          </Link>
          <Link
            href="/admin/funis"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition-colors"
          >
            <Filter size={14} /> Funis &amp; Produtos
          </Link>
          <Link
            href="/admin/new"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition-colors"
          >
            <Plus size={14} /> Novo usuário
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0A0F1E] border-b border-[#1F2937] text-left">
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">E-mail</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Nome</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Papel</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Último login</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Criado em</th>
                  <th className="px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                      Nenhum usuário cadastrado.{' '}
                      <Link href="/admin/new" className="text-cyan-400 hover:underline">
                        Criar o primeiro
                      </Link>
                    </td>
                  </tr>
                )}
                {users.map(u => (
                  <tr key={u.id} className="border-b border-[#1F2937] last:border-b-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/${u.id}`} className="text-cyan-400 hover:underline font-medium">
                        {u.email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{u.name ?? <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(u.last_login_at)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/${u.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 hover:border-cyan-500/40 transition-colors"
                      >
                        <Pencil size={12} /> Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
