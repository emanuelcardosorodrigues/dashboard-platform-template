export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import {
  ArrowLeft,
  ShieldAlert,
  KeyRound,
  CheckCircle2,
  XCircle,
  History,
  LogIn,
  LogOut,
  Ban,
  Sparkles,
  Settings,
} from 'lucide-react'
import { DASHBOARD_PATHS } from '@/lib/auth'
import { DATA_DOMAINS } from '@/lib/access'
import {
  updateUserProfileAction,
  updateAiConfigAction,
  resetPasswordAction,
  updateWorkspacesAction,
  revokeSessionAction,
} from '../actions'
import CopyButton from './CopyButton'
import SubmitButton from '../SubmitButton'

interface UserDetail {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'viewer'
  status: 'active' | 'pending_onboarding' | 'disabled'
  ai_config: unknown
  allowed_paths: string[] | null
  default_filters: Record<string, unknown> | null
  phone: string | null
  avatar_url: string | null
  admin_notes: string | null
  created_at: string
  last_login_at: string | null
  updated_at: string
}

interface SessionRow {
  id: string
  ip: string | null
  user_agent: string | null
  created_at: string
  last_seen_at: string
  expires_at: string
  revoked_at: string | null
}

interface AuditRow {
  id: number
  occurred_at: string
  action: string
  status: string
  ip: string | null
  user_agent: string | null
  resource: string | null
  metadata: Record<string, unknown> | null
}

interface AiConfigShape {
  quota_daily: number
  disabled: boolean
  /** undefined = não configurado (→ todos, compat); [] = nenhum; ver lib/access.ts */
  data_domains?: string[]
}

const PAGE_LABELS: Record<string, string> = {
  '/visao-geral': 'Visão Geral',
  '/calculadora': 'Calculadora Estratégica',
  '/criativos': 'Criativos',
  '/criativos-ia': 'Criativos IA',
  '/campanhas': 'Campanhas',
  '/qualificacao': 'Qualificação',
  '/funil': 'Funil',
  '/financeiro': 'Financeiro',
  '/comparacao': 'Comparação',
  '/perfil-comprador': 'Perfil do Comprador',
  '/voz-comprador': 'Voz do Comprador',
  '/analise-estrategica': 'Análise Estratégica',
  '/experimentos': 'Experimentos',
  '/quizzes': 'Quizzes',
  '/saude-trafego': 'Saúde do Tráfego',
  '/clarity': 'Clarity',
  '/notas-fiscais': 'Notas Fiscais',
  '/insights-ia': 'Insights IA',
  '/vsl': 'VSLs',
  '/ga4': 'GA4',
  '/raio-x': 'Raio-X da Escala',
}

const AUDIT_ACTION_LABELS: Record<string, { label: string; icon: typeof LogIn }> = {
  'login.success': { label: 'Login bem-sucedido', icon: LogIn },
  'login.logout': { label: 'Logout', icon: LogOut },
  'login.failed': { label: 'Tentativa de login falhou', icon: Ban },
  'login.locked': { label: 'Bloqueio acionado', icon: Ban },
  'login.lockout_triggered': { label: 'Bloqueio temporário (15min)', icon: Ban },
  'admin.user.update': { label: 'Perfil atualizado', icon: Settings },
  'admin.user.ai_config': { label: 'Configuração de IA alterada', icon: Sparkles },
  'admin.user.password_reset': { label: 'Senha resetada', icon: KeyRound },
  'admin.user.session_revoke': { label: 'Sessão revogada', icon: Ban },
  'admin.user.create': { label: 'Usuário criado', icon: CheckCircle2 },
  'ai.ask.success': { label: 'Pergunta à IA', icon: Sparkles },
  'ai.ask.rate_limited': { label: 'Cota IA estourada', icon: Ban },
  'ai.ask.path_denied': { label: 'IA: rota negada', icon: Ban },
}

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

function normalizeAiConfig(raw: unknown, role: 'admin' | 'viewer'): AiConfigShape {
  const defaults = { quota_daily: role === 'admin' ? 100 : 20, disabled: false }
  if (!raw || typeof raw !== 'object') return defaults
  const r = raw as Record<string, unknown>
  const quota = typeof r.quota_daily === 'number' && r.quota_daily > 0 ? Math.min(r.quota_daily, 500) : defaults.quota_daily
  const disabled = r.disabled === true
  const out: AiConfigShape = { quota_daily: quota, disabled }
  // Preserva undefined (não configurado) vs [] (nenhum) — como em lib/sessions.ts.
  if (Array.isArray(r.data_domains)) {
    out.data_domains = r.data_domains.filter((d): d is string => typeof d === 'string')
  }
  return out
}

async function fetchUser(id: string): Promise<UserDetail | null> {
  const sb = db()
  const { data } = await sb
    .from('users')
    .select('id,email,name,role,status,ai_config,allowed_paths,default_filters,phone,avatar_url,admin_notes,created_at,last_login_at,updated_at')
    .eq('id', id)
    .maybeSingle() as { data: UserDetail | null }
  return data
}

interface ProjetoRow { id: string; slug: string; nome: string }

/** Projetos ATIVOS (arquivado nunca aparece) + em quais o usuário já está (por email). */
async function fetchProjetos(email: string | null): Promise<{ todos: ProjetoRow[]; doUsuario: Set<string> }> {
  const sb = db()
  const { data: todos } = await sb
    .from('workspaces').select('id, slug, nome').is('arquivado_at', null).order('nome') as {
      data: ProjetoRow[] | null
    }
  if (!email) return { todos: todos ?? [], doUsuario: new Set() }
  const { data: membros } = await sb
    .from('workspace_members').select('workspace_id').eq('user_email', email.trim().toLowerCase()) as {
      data: { workspace_id: string }[] | null
    }
  return { todos: todos ?? [], doUsuario: new Set((membros ?? []).map((m) => m.workspace_id)) }
}

async function fetchSessions(userId: string): Promise<SessionRow[]> {
  const sb = db()
  const { data } = await sb
    .from('user_sessions')
    .select('id,ip,user_agent,created_at,last_seen_at,expires_at,revoked_at')
    .eq('user_id', userId)
    .order('last_seen_at', { ascending: false })
    .limit(50) as { data: SessionRow[] | null }
  return data ?? []
}

async function fetchTodayUsage(userId: string): Promise<number> {
  const sb = db()
  const today = new Date().toISOString().slice(0, 10)
  const { data } = await sb
    .from('ai_usage_daily')
    .select('count')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle() as { data: { count: number } | null }
  return data?.count ?? 0
}

async function fetchHistory(userId: string): Promise<AuditRow[]> {
  const sb = db()
  // 3 queries separadas em vez de .or() com operador jsonb ->>, que tem encoding chato no PostgREST.
  // 1) eventos onde o user foi o ator (actor_label = user_id, padrão pós-fase 2.6)
  // 2) eventos onde o user foi o alvo (metadata.target_user_id)
  // 3) eventos antigos onde a action.ai_config gravou metadata.user_id
  const cols = 'id,occurred_at,action,status,ip,user_agent,resource,metadata'
  const q1 = sb.from('audit_log').select(cols).eq('actor_label', userId).order('occurred_at', { ascending: false }).limit(100)
  const q2 = sb.from('audit_log').select(cols).eq('metadata->>target_user_id', userId).order('occurred_at', { ascending: false }).limit(100)
  const q3 = sb.from('audit_log').select(cols).eq('metadata->>user_id', userId).order('occurred_at', { ascending: false }).limit(100)
  const [a, b, c] = await Promise.all([q1, q2, q3]) as { data: AuditRow[] | null }[]

  const seen = new Set<number>()
  const merged: AuditRow[] = []
  for (const row of [...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(row)
  }
  merged.sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : -1))
  return merged.slice(0, 100)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
}

const ERROR_MESSAGES: Record<string, string> = {
  self_lockout: 'Você não pode rebaixar nem desativar sua própria conta de admin.',
  db: 'Erro ao salvar no banco.',
  sem_padrao: 'Senha padrão não configurada (env DEFAULT_USER_PASSWORD). Use "Definir senha" ou configure o env.',
  senha_curta: 'A senha precisa ter ao menos 8 caracteres.',
  sem_usuario: 'Usuário não encontrado.',
}

const SAVED_MESSAGES: Record<string, string> = {
  profile: 'Perfil atualizado.',
  ai: 'Configurações de IA atualizadas.',
  password: 'Senha resetada. Copie a senha abaixo — ela não será mostrada novamente.',
  session_revoke: 'Sessão revogada.',
  workspaces: 'Projetos do usuário atualizados.',
}

type Tab = 'perfil' | 'ia' | 'sessoes' | 'historico'
function parseTab(t: string | undefined): Tab {
  if (t === 'ia' || t === 'sessoes' || t === 'historico') return t
  return 'perfil'
}

function TabLink({ id, current, tab, label, icon: Icon }: { id: string; current: Tab; tab: Tab; label: string; icon: typeof LogIn }) {
  const active = current === tab
  const href = tab === 'perfil' ? `/admin/${id}` : `/admin/${id}?tab=${tab}`
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors inline-flex items-center gap-1.5 ${
        active
          ? 'text-cyan-400 border-cyan-500'
          : 'text-gray-400 border-transparent hover:text-white hover:border-white/20'
      }`}
    >
      <Icon size={14} />
      {label}
    </Link>
  )
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; created?: string; saved?: string; temp?: string; error?: string; msg?: string }>
}) {
  const { id } = await params
  const { tab: tabRaw, created, saved, temp, error, msg } = await searchParams
  const tab = parseTab(tabRaw)

  const [user, sessions, todayUsage, history] = await Promise.all([
    fetchUser(id),
    fetchSessions(id),
    fetchTodayUsage(id),
    tab === 'historico' ? fetchHistory(id) : Promise.resolve([]),
  ])

  if (!user) notFound()

  // Projetos só importam na aba Perfil (onde o admin escolhe onde o usuário entra).
  const projetos = tab === 'perfil'
    ? await fetchProjetos(user.email)
    : { todos: [] as ProjetoRow[], doUsuario: new Set<string>() }

  const aiConfig = normalizeAiConfig(user.ai_config, user.role)
  const activeSessions = sessions.filter(s => !s.revoked_at && new Date(s.expires_at) > new Date())
  const inactiveSessions = sessions.filter(s => s.revoked_at || new Date(s.expires_at) <= new Date())
  const allowedPaths = new Set(user.allowed_paths ?? [])
  const defaultFilters = (user.default_filters ?? {}) as Record<string, string>

  const successMessage = saved ? SAVED_MESSAGES[saved] : null
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
        {user.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover border border-[#1F2937]" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-white font-[family-name:var(--font-heading)] truncate">
            {user.name ?? user.email}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {user.email}{user.phone ? ` · ${user.phone}` : ''}
          </p>
        </div>
      </header>

      <div className="flex items-center gap-1 px-6 border-b border-[#1F2937] bg-[#0A0F1E] shrink-0">
        <TabLink id={user.id} current={tab} tab="perfil" label="Perfil" icon={Settings} />
        <TabLink id={user.id} current={tab} tab="ia" label="IA" icon={Sparkles} />
        <TabLink id={user.id} current={tab} tab="sessoes" label="Sessões" icon={KeyRound} />
        <TabLink id={user.id} current={tab} tab="historico" label="Histórico" icon={History} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-4">
          {created === '1' && temp && (
            <TempPasswordBanner
              title="Usuário criado"
              description={`Senha temporária para ${user.email}. Copie agora — ela não será mostrada novamente.`}
              temp={temp}
            />
          )}
          {saved === 'password' && temp && (
            <TempPasswordBanner
              title="Senha resetada"
              description={`Nova senha temporária para ${user.email}. Sessões ativas foram revogadas.`}
              temp={temp}
            />
          )}
          {successMessage && saved !== 'password' && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircle2 size={16} /> {successMessage}
            </div>
          )}
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} /> {errorMessage}
              </div>
              {msg && <span className="block text-xs text-rose-400/80 mt-1 pl-6">{decodeURIComponent(msg)}</span>}
            </div>
          )}

          {tab === 'perfil' && (
            <ProfileTab user={user} allowedPaths={allowedPaths} defaultFilters={defaultFilters} projetos={projetos} />
          )}
          {tab === 'ia' && <AiTab user={user} aiConfig={aiConfig} todayUsage={todayUsage} />}
          {tab === 'sessoes' && <SessionsTab user={user} activeSessions={activeSessions} inactiveSessions={inactiveSessions} />}
          {tab === 'historico' && <HistoryTab events={history} />}
        </div>
      </div>
    </div>
  )
}

function TempPasswordBanner({ title, description, temp }: { title: string; description: string; temp: string }) {
  const decoded = decodeURIComponent(temp)
  return (
    <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-start gap-3">
        <KeyRound size={18} className="text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-200">{title}</h3>
          <p className="text-xs text-amber-300/80 mt-0.5">{description}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded-lg bg-[#0A0F1E] border border-amber-500/30 text-amber-200 font-mono text-sm select-all">
              {decoded}
            </code>
            <CopyButton value={decoded} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ProfileTab({
  user,
  allowedPaths,
  defaultFilters,
  projetos,
}: {
  user: UserDetail
  allowedPaths: Set<string>
  defaultFilters: Record<string, string>
  projetos: { todos: ProjetoRow[]; doUsuario: Set<string> }
}) {
  return (
    <div className="space-y-4">
    {/* Projetos: form irmão (HTML não permite form aninhado no de perfil) */}
    <form action={updateWorkspacesAction} className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-4">
      <input type="hidden" name="user_id" value={user.id} />
      <div>
        <h3 className="text-sm font-semibold text-white">Projetos</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Em quais projetos este usuário entra.{' '}
          {user.role === 'admin'
            ? 'Admin enxerga todos os projetos independente desta seleção.'
            : 'Ele só verá os marcados aqui.'}
        </p>
      </div>
      {projetos.todos.length === 0 ? (
        <p className="text-xs text-gray-500">Nenhum projeto ativo.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {projetos.todos.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0A0F1E] border border-[#1F2937] cursor-pointer hover:border-cyan-500/30 transition-colors"
            >
              <input
                type="checkbox"
                name="workspaces"
                value={p.id}
                defaultChecked={projetos.doUsuario.has(p.id)}
                className="accent-cyan-500 w-4 h-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm text-white truncate">{p.nome}</span>
                <span className="block text-[11px] text-gray-500">{p.slug}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Salvando…"
          className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
        >
          Salvar projetos
        </SubmitButton>
      </div>
    </form>

    <form action={updateUserProfileAction} className="space-y-4">
      <input type="hidden" name="user_id" value={user.id} />

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-white">Identidade</h3>

        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1.5">E-mail</label>
          <input
            type="email"
            value={user.email}
            disabled
            className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="block text-xs font-medium text-gray-300 mb-1.5">Nome</label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={user.name ?? ''}
              maxLength={120}
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-gray-300 mb-1.5">Telefone</label>
            <input
              id="phone"
              name="phone"
              type="text"
              defaultValue={user.phone ?? ''}
              maxLength={30}
              placeholder="(11) 99999-9999"
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>

        <div>
          <label htmlFor="avatar_url" className="block text-xs font-medium text-gray-300 mb-1.5">URL do avatar</label>
          <input
            id="avatar_url"
            name="avatar_url"
            type="url"
            defaultValue={user.avatar_url ?? ''}
            maxLength={500}
            placeholder="https://..."
            className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
          />
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-white">Acesso</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="role" className="block text-xs font-medium text-gray-300 mb-1.5">Papel</label>
            <select
              id="role"
              name="role"
              defaultValue={user.role}
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Admin vê todas as abas. Viewer obedece o allowlist abaixo.</p>
          </div>
          <div>
            <label htmlFor="status" className="block text-xs font-medium text-gray-300 mb-1.5">Status</label>
            <select
              id="status"
              name="status"
              defaultValue={user.status}
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            >
              <option value="active">Ativo</option>
              <option value="pending_onboarding">Pendente de onboarding</option>
              <option value="disabled">Desativado</option>
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Desativar revoga sessões.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1.5">
            Abas com acesso (a IA responde sobre estas)
          </label>
          <div className="grid grid-cols-2 gap-2">
            {DASHBOARD_PATHS.map(path => (
              <label key={path} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer p-2 rounded-lg border border-[#1F2937] bg-[#0A0F1E] hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50 has-[:checked]:bg-cyan-500/5 transition-colors">
                <input
                  type="checkbox"
                  name="allowed_paths"
                  value={path}
                  defaultChecked={allowedPaths.has(path)}
                  className="accent-cyan-500"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-white truncate">{PAGE_LABELS[path] ?? path}</span>
                  <code className="block text-[10px] text-gray-500 truncate">{path}</code>
                </span>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Admin role vê tudo independentemente do allowlist. Para viewer, esta é a fonte da verdade.
          </p>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
        <h3 className="text-sm font-semibold text-white">Filtros padrão</h3>
        <p className="text-xs text-gray-500 -mt-3">Aplicados quando o user abre o dashboard pela primeira vez na sessão.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="default_funil" className="block text-xs font-medium text-gray-300 mb-1.5">Funil</label>
            <input
              id="default_funil"
              name="default_funil"
              type="text"
              defaultValue={defaultFilters.funil ?? ''}
              maxLength={30}
              placeholder="all, col-, dpl-, lps-, plo"
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label htmlFor="default_conta" className="block text-xs font-medium text-gray-300 mb-1.5">Conta Meta</label>
            <input
              id="default_conta"
              name="default_conta"
              type="text"
              defaultValue={defaultFilters.conta ?? ''}
              maxLength={30}
              placeholder="all ou ID da conta"
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label htmlFor="default_de" className="block text-xs font-medium text-gray-300 mb-1.5">Data inicial</label>
            <input
              id="default_de"
              name="default_de"
              type="date"
              defaultValue={defaultFilters.de ?? ''}
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
          <div>
            <label htmlFor="default_ate" className="block text-xs font-medium text-gray-300 mb-1.5">Data final</label>
            <input
              id="default_ate"
              name="default_ate"
              type="date"
              defaultValue={defaultFilters.ate ?? ''}
              className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>
      </div>

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-3">
        <h3 className="text-sm font-semibold text-white">Notas internas</h3>
        <p className="text-xs text-gray-500 -mt-2">Visível só pro admin. O próprio usuário não vê.</p>
        <textarea
          name="admin_notes"
          defaultValue={user.admin_notes ?? ''}
          maxLength={2000}
          rows={4}
          placeholder="Contexto sobre este usuário..."
          className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 resize-y"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">
          Criado em {formatDate(user.created_at)} · Atualizado em {formatDate(user.updated_at)} · Último login {formatDate(user.last_login_at)}
        </div>
        <SubmitButton
          pendingLabel="Salvando…"
          className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
        >
          Salvar perfil
        </SubmitButton>
      </div>
    </form>
    </div>
  )
}

function AiTab({ user, aiConfig, todayUsage }: { user: UserDetail; aiConfig: AiConfigShape; todayUsage: number }) {
  const allowedPaths = user.allowed_paths ?? []
  const isAdmin = user.role === 'admin'
  // Estado dos checkboxes de domínio. undefined = não configurado → todos marcados
  // (reflete o acesso EFETIVO atual: fail-open de retrocompat em lib/access.ts).
  const configuredDomains = aiConfig.data_domains
  const allDomainsGranted = isAdmin || configuredDomains == null
  const isDomainChecked = (id: string) => allDomainsGranted || configuredDomains!.includes(id)
  return (
    <form action={updateAiConfigAction} className="bg-[#111827] border border-[#1F2937] rounded-xl p-6 space-y-5">
      <input type="hidden" name="user_id" value={user.id} />

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1F2937]">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Uso hoje</div>
          <div className="text-2xl font-semibold text-white mt-1">
            {todayUsage}<span className="text-base text-gray-500"> / {aiConfig.quota_daily}</span>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1F2937]">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Status IA</div>
          <div className="text-sm font-medium mt-1 flex items-center gap-1.5">
            {aiConfig.disabled
              ? <><XCircle size={14} className="text-rose-400" /><span className="text-rose-300">Desabilitada</span></>
              : <><CheckCircle2 size={14} className="text-emerald-400" /><span className="text-emerald-300">Habilitada</span></>}
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="quota_daily" className="block text-xs font-medium text-gray-300 mb-1.5">
          Cota diária (perguntas)
        </label>
        <input
          id="quota_daily"
          name="quota_daily"
          type="number"
          min={1}
          max={500}
          defaultValue={aiConfig.quota_daily}
          className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
        />
        <p className="text-[11px] text-gray-400 mt-1">Máximo 500 por dia. Reset 00:00 UTC.</p>
      </div>

      <div className="p-4 rounded-lg bg-[#0A0F1E] border border-[#1F2937]">
        <h4 className="text-xs font-medium text-gray-300 mb-2 flex items-center gap-1.5">
          <Sparkles size={12} /> Escopo da IA
        </h4>
        <p className="text-[11px] text-gray-500 mb-3">
          A IA responde sobre as mesmas abas que o usuário tem acesso. Para mudar, edite o allowlist na aba <b>Perfil</b>.
        </p>
        {user.role === 'admin' ? (
          <div className="text-xs text-cyan-300 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> Admin — IA responde sobre todas as {DASHBOARD_PATHS.length} abas.
          </div>
        ) : allowedPaths.length === 0 ? (
          <div className="text-xs text-rose-300 flex items-center gap-1.5">
            <XCircle size={14} /> Sem abas liberadas — IA não vai responder nada.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allowedPaths.map(p => (
              <span key={p} className="inline-flex items-center gap-1 text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded px-2 py-0.5">
                {PAGE_LABELS[p] ?? p}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 rounded-lg bg-[#0A0F1E] border border-[#1F2937]">
        <h4 className="text-xs font-medium text-gray-300 mb-2 flex items-center gap-1.5">
          <Sparkles size={12} /> Acesso por domínio de dados
        </h4>
        <p className="text-[11px] text-gray-500 mb-3">
          Escopa a IA (Equipe/Odin) a blocos de dados. Marcado = liberado.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {DATA_DOMAINS.map(d => (
            <label
              key={d.id}
              className={`flex items-center gap-2 text-sm p-2 rounded-lg border border-[#1F2937] bg-[#0A0F1E] transition-colors ${
                isAdmin
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer hover:border-cyan-500/30 has-[:checked]:border-cyan-500/50'
              }`}
            >
              <input
                type="checkbox"
                name="data_domains"
                value={d.id}
                defaultChecked={isDomainChecked(d.id)}
                disabled={isAdmin}
                className="accent-cyan-500"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-white truncate">{d.label}</span>
                <code className="block text-[10px] text-gray-500 truncate">{d.id}</code>
              </span>
            </label>
          ))}
        </div>
        {isAdmin ? (
          <p className="text-[11px] text-cyan-400/80 mt-2 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> Admin acessa todos os domínios — não editável.
          </p>
        ) : configuredDomains == null ? (
          <p className="text-[11px] text-amber-400/90 mt-2">
            Não configurado: acesso a <b>todos</b> os domínios por padrão. Desmarque para restringir e salve.
          </p>
        ) : configuredDomains.length === 0 ? (
          <p className="text-[11px] text-rose-300 mt-2 flex items-center gap-1.5">
            <XCircle size={12} /> Nenhum domínio liberado — a IA não responde sobre os dados deste usuário.
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 mt-2">
            {configuredDomains.length} de {DATA_DOMAINS.length} domínios liberados.
          </p>
        )}
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="disabled" defaultChecked={aiConfig.disabled} className="accent-rose-500" />
          <span className="text-sm text-gray-300">
            Desabilitar IA para este usuário
            <span className="block text-[11px] text-gray-400">Override hard — ignora cota e escopo</span>
          </span>
        </label>
      </div>

      <div className="pt-2 border-t border-[#1F2937] flex justify-end">
        <SubmitButton
          pendingLabel="Salvando…"
          className="px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition-colors"
        >
          Salvar configurações de IA
        </SubmitButton>
      </div>
    </form>
  )
}

function SessionsTab({
  user,
  activeSessions,
  inactiveSessions,
}: {
  user: UserDetail
  activeSessions: SessionRow[]
  inactiveSessions: SessionRow[]
}) {
  return (
    <div className="space-y-4">
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Senha</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Qualquer reset revoga <strong>todas</strong> as sessões ativas do usuário. Só a temporária vai por email.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form action={resetPasswordAction}>
            <input type="hidden" name="user_id" value={user.id} />
            <input type="hidden" name="modo" value="padrao" />
            <SubmitButton
              pendingLabel="Aplicando…"
              className="px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-medium hover:bg-cyan-500/20 transition-colors"
            >
              <KeyRound size={12} /> Resetar para a senha padrão
            </SubmitButton>
          </form>

          <form action={resetPasswordAction}>
            <input type="hidden" name="user_id" value={user.id} />
            <input type="hidden" name="modo" value="random" />
            <SubmitButton
              pendingLabel="Gerando…"
              className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium hover:bg-amber-500/20 transition-colors"
            >
              <KeyRound size={12} /> Gerar temporária (envia email)
            </SubmitButton>
          </form>
        </div>

        <form action={resetPasswordAction} className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#1F2937]">
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="modo" value="custom" />
          <input
            name="custom_password"
            type="text"
            minLength={8}
            required
            autoComplete="off"
            placeholder="Definir uma senha específica (mín. 8)"
            className="flex-1 min-w-[220px] mt-3 bg-[#0A0F1E] border border-[#1F2937] rounded-lg px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50"
          />
          <SubmitButton
            pendingLabel="Definindo…"
            className="mt-3 px-3 py-2 rounded-lg bg-[#1F2937] border border-[#374151] text-gray-200 text-xs font-medium hover:bg-[#374151] transition-colors"
          >
            Definir
          </SubmitButton>
        </form>
      </div>

      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1F2937] bg-[#0A0F1E]">
          <h3 className="text-sm font-semibold text-white">Sessões ativas ({activeSessions.length})</h3>
        </div>
        {activeSessions.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-500 text-sm">Nenhuma sessão ativa.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[#1F2937]">
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">IP</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Browser</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Último uso</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Expira</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider w-1"></th>
              </tr>
            </thead>
            <tbody>
              {activeSessions.map(s => (
                <tr key={s.id} className="border-b border-[#1F2937] last:border-b-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-2 text-gray-300 font-mono text-xs">{s.ip ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-xs">{s.user_agent ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{formatDate(s.last_seen_at)}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{formatDate(s.expires_at)}</td>
                  <td className="px-4 py-2">
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="user_id" value={user.id} />
                      <input type="hidden" name="session_id" value={s.id} />
                      <SubmitButton
                        pendingLabel="Revogando…"
                        className="px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] hover:bg-rose-500/20 transition-colors"
                      >
                        Revogar
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {inactiveSessions.length > 0 && (
        <details className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-sm text-gray-400 cursor-pointer hover:text-white">
            Sessões inativas ({inactiveSessions.length})
          </summary>
          <table className="w-full text-sm border-t border-[#1F2937]">
            <thead>
              <tr className="text-left border-b border-[#1F2937] bg-[#0A0F1E]">
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">IP</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Browser</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Último uso</th>
                <th className="px-4 py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wider">Revogada em</th>
              </tr>
            </thead>
            <tbody>
              {inactiveSessions.slice(0, 20).map(s => (
                <tr key={s.id} className="border-b border-[#1F2937] last:border-b-0">
                  <td className="px-4 py-2 text-gray-500 font-mono text-xs">{s.ip ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs truncate max-w-xs">{s.user_agent ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{formatDate(s.last_seen_at)}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{formatDate(s.revoked_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

function HistoryTab({ events }: { events: AuditRow[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 text-center">
        <History size={28} className="text-gray-400 mx-auto" />
        <p className="text-sm text-gray-500 mt-3">Sem eventos registrados ainda.</p>
      </div>
    )
  }
  return (
    <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1F2937] bg-[#0A0F1E]">
        <h3 className="text-sm font-semibold text-white">Últimos 100 eventos</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">Logins, alterações de perfil, uso da IA, ações de admin.</p>
      </div>
      <ul className="divide-y divide-[#1F2937]">
        {events.map(e => {
          const meta = AUDIT_ACTION_LABELS[e.action] ?? { label: e.action, icon: History }
          const Icon = meta.icon
          const isDenied = e.status === 'denied' || e.status === 'error'
          return (
            <li key={e.id} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 shrink-0 ${isDenied ? 'text-rose-400' : 'text-cyan-400'}`}>
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm text-white">{meta.label}</span>
                    {isDenied && (
                      <span className="text-[10px] uppercase tracking-wider text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-1.5 py-0.5">
                        {e.status}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{formatDate(e.occurred_at)}</span>
                    {e.ip && <><span>·</span><code className="font-mono">{e.ip}</code></>}
                    {e.user_agent && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-[300px]">{e.user_agent}</span>
                      </>
                    )}
                  </div>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-400">metadata</summary>
                      <pre className="mt-1 text-[10px] text-gray-500 bg-[#0A0F1E] border border-[#1F2937] rounded p-2 overflow-x-auto">
                        {JSON.stringify(e.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
