import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { ChevronLeft, Check, Lock, Plug, SquarePlay, Camera, Music2, RefreshCw, Zap, Circle } from 'lucide-react'
import { listConfiguredProviders, type IntegrationProvider } from '@/lib/integrations/credentials'
import { PROVIDER_FIELDS, PROVIDER_LABEL, PROVIDER_ORDER, PROVIDER_OAUTH } from '@/lib/integrations/providers'
import { saveCredentialAction, testCredentialAction, updateWorkspaceAction, setMembershipAction, addMetaAccountAction, removeMetaAccountAction, disconnectOrganicAccountAction, syncOrganicNowAction, createOrganicLinkAction, deleteOrganicLinkAction, connectInstagramViaSystemUserAction } from '../actions'
import { getCloudflareConfig } from '@/lib/integrations/factory'
import { isDefaultWorkspace } from '@/lib/workspace-context'
import SubmitButton from '../../SubmitButton'
import DeleteCredentialButton from './DeleteCredentialButton'

export const dynamic = 'force-dynamic'
// o botão "Sincronizar agora" espera o cron por até ~50s antes de soltar
export const maxDuration = 60

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR') : '')

export default async function ProjetoCredenciaisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const { data: ws } = await db().from('workspaces').select('*').eq('id', id).maybeSingle()
  if (!ws) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-400">Projeto não encontrado. <Link href="/admin/projetos" className="text-blue-400">Voltar</Link></p>
      </div>
    )
  }
  const logoUrl = (ws as { logo_url?: string | null }).logo_url ?? ''
  const configured = await listConfiguredProviders(id)
  const byProvider = new Map(configured.map((c) => [c.provider, c]))

  // Contas orgânicas conectadas (YouTube/Instagram/TikTok via OAuth)
  const { data: organicData } = await db().from('organic_accounts')
    .select('id, platform, external_id, handle, display_name, avatar_url, status, last_sync_at, last_error')
    .eq('workspace_id', id).neq('status', 'disconnected').order('platform')
  const organicAccounts = (organicData ?? []) as {
    id: string; platform: string; external_id: string; handle: string | null
    display_name: string | null; avatar_url: string | null; status: string
    last_sync_at: string | null; last_error: string | null
  }[]

  // Links rastreáveis do orgânico (encurtador no domínio do cliente)
  const [{ data: linksData }, cfCfg] = await Promise.all([
    db().from('organic_links')
      .select('id, slug, destination_url, platform, post_external_id, clicks, active, created_at')
      .eq('workspace_id', id).order('created_at', { ascending: false }).limit(100),
    getCloudflareConfig(id).catch(() => null),
  ])
  const organicLinks = (linksData ?? []) as {
    id: string; slug: string; destination_url: string; platform: string | null
    post_external_id: string | null; clicks: number; active: boolean; created_at: string
  }[]
  const linksDomain = cfCfg?.linksDomain ?? null

  // Usuários + membership deste projeto (pra atribuir acesso) + contas Meta + se é o DEMO.
  const [{ data: usersData }, { data: membersData }, { data: metaAccData }, isLst] = await Promise.all([
    db().from('users').select('email, name, role').order('email'),
    db().from('workspace_members').select('user_email, role').eq('workspace_id', id),
    db().from('workspace_meta_accounts').select('account_id, rotulo').eq('workspace_id', id).order('criado_em'),
    isDefaultWorkspace(id),
  ])
  const users = (usersData ?? []) as { email: string; name: string | null; role: string }[]
  const memberEmails = new Set((membersData ?? []).map((m: { user_email: string }) => m.user_email))
  const metaAccounts = (metaAccData ?? []) as { account_id: string; rotulo: string | null }[]
  const metaCount = metaAccounts.length

  // Checklist de onboarding: o DEMO (default) opera por variáveis de ambiente, então
  // conta como "conectado" mesmo sem linha em workspace_credentials.
  const has = (p: IntegrationProvider) => byProvider.has(p) || isLst
  const checklist: { label: string; done: boolean; todo: string; extra?: string; optional?: boolean }[] = [
    { label: 'Nome e logo do projeto', done: !!logoUrl, todo: 'Defina a URL do logo no formulário acima.', extra: undefined },
    { label: 'Meta Ads conectado', done: has('meta'), todo: 'Cole o Access Token na seção Meta Ads abaixo.', extra: metaCount > 0 ? `${metaCount} conta(s) Meta atribuída(s)` : (has('meta') ? 'atribua as contas Meta a este projeto' : undefined) },
    { label: 'Hotmart (vendas) conectada', done: has('hotmart'), todo: 'Salve Client ID/Secret + o webhookToken (e aponte o painel Hotmart pra /api/webhook/hotmart).', extra: undefined },
    { label: 'Pelo menos 1 usuário com acesso', done: memberEmails.size > 0, todo: 'Dê acesso a um usuário na seção abaixo (admins já veem tudo).', extra: memberEmails.size > 0 ? `${memberEmails.size} com acesso` : undefined },
    { label: 'vTurb (VSL) — opcional', done: has('vturb'), todo: '', extra: undefined, optional: true },
    { label: 'GA4 / Clarity / Cloudflare — opcional', done: has('ga4') || has('clarity') || has('cloudflare'), todo: '', extra: undefined, optional: true },
  ]
  const requiredPending = checklist.filter((c) => !c.optional && !c.done).length

  return (
    <div className="p-6 max-w-3xl">
      <Link href="/admin/projetos" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-3">
        <ChevronLeft size={15} /> Projetos
      </Link>
      <h1 className="text-xl font-bold text-white">{ws.nome}</h1>
      <p className="text-xs text-gray-500 font-mono mb-1">{ws.slug}</p>
      <p className="text-sm text-gray-400 mb-5 flex items-center gap-1.5">
        <Lock size={13} /> Segredos cifrados em repouso. Deixe um campo em branco pra <strong className="text-gray-300">não alterá-lo</strong>.
      </p>

      {sp.novo && <Banner kind="ok">Projeto criado! Agora plugue as integrações e atribua os usuários abaixo.</Banner>}
      {sp.ok === 'projeto' && <Banner kind="ok">Projeto atualizado.</Banner>}
      {sp.membro && <Banner kind="ok">Acesso de usuário atualizado.</Banner>}
      {sp.ok && sp.ok !== 'projeto' && <Banner kind="ok">Credenciais de <b>{PROVIDER_LABEL[sp.ok as IntegrationProvider] ?? sp.ok}</b> salvas e cifradas.</Banner>}
      {sp.removido && <Banner kind="warn">Credenciais de <b>{PROVIDER_LABEL[sp.removido as IntegrationProvider] ?? sp.removido}</b> removidas.</Banner>}
      {sp.erro === 'sem_master_key' && <Banner kind="err">Master key ausente (CREDENTIALS_MASTER_KEY). Não foi salvo.</Banner>}
      {sp.erro === 'vazio' && <Banner kind="err">Nenhum campo preenchido — nada foi salvo.</Banner>}
      {sp.yt === 'ok' && <Banner kind="ok">Canal do YouTube conectado! O primeiro sync roda no próximo cron (ou dispare manual).</Banner>}
      {sp.yt_erro && <Banner kind="err">Conexão com YouTube falhou ({sp.yt_erro}). Tente de novo — se persistir, confira o OAuth app no Google Cloud.</Banner>}
      {sp.ig === 'ok' && <Banner kind="ok">{sp.n ?? '1'} conta(s) do Instagram conectada(s)! Use &quot;Sincronizar agora&quot; pra puxar os primeiros dados.</Banner>}
      {sp.ig === 'su_ok' && <Banner kind="ok">{sp.n ?? '1'} conta(s) do Instagram conectada(s) via System User (tokens não expiram). Use &quot;Sincronizar agora&quot;.</Banner>}
      {sp.ig === 'sem_meta' && <Banner kind="err">Sem token do Meta neste projeto — configure o Meta Ads primeiro (o System User precisa do token).</Banner>}
      {sp.ig === 'sem_conta_su' && <Banner kind="err">O token do System User não enxerga nenhuma conta IG — confira se as Páginas/contas IG estão atribuídas a ele no Business Manager e se tem o escopo instagram_manage_insights.</Banner>}
      {sp.ig === 'erro_descoberta' && <Banner kind="err">Falha ao descobrir contas IG pelo token do Meta. Tente de novo.</Banner>}
      {sp.ig_erro === 'sem_conta_ig' && <Banner kind="err">Nenhuma conta Instagram profissional encontrada — confira se o perfil é Business/Creator e está vinculado a uma Página do Facebook.</Banner>}
      {sp.ig_erro && sp.ig_erro !== 'sem_conta_ig' && <Banner kind="err">Conexão com Instagram falhou ({sp.ig_erro}). Tente de novo — se persistir, confira o app Meta (envs META_APP_ID/SECRET e redirect URI).</Banner>}
      {sp.org_off && <Banner kind="warn">Conta desconectada. Os dados históricos foram preservados.</Banner>}
      {sp.org_off_erro && <Banner kind="err">Falha ao desconectar — recarregue a página (Cmd+Shift+R) e tente de novo.</Banner>}
      {sp.sync?.startsWith('ok_') && <Banner kind="ok">Sync concluído: {sp.sync.slice(3)} conteúdos sincronizados.</Banner>}
      {sp.sync?.startsWith('parcial_') && <Banner kind="warn">Sync concluído com erros em alguma conta ({sp.sync.slice(8)} conteúdos ok) — veja o status abaixo.</Banner>}
      {sp.sync === 'disparado' && <Banner kind="ok">Sync disparado em segundo plano — acompanhe pelo &quot;último sync&quot; da conta (atualize a página em ~1 min).</Banner>}
      {sp.sync === 'sem_conta' && <Banner kind="warn">Nenhuma conta conectada neste projeto — conecte um canal primeiro.</Banner>}
      {sp.sync === 'erro' && <Banner kind="err">Falha ao disparar o sync. Tente de novo; se persistir, veja os logs.</Banner>}
      {sp.sync === 'sem_secret' && <Banner kind="err">CRON_SECRET ausente no ambiente — sync manual indisponível.</Banner>}
      {sp.link === 'ok' && <Banner kind="ok">Link criado e publicado no Worker do cliente.</Banner>}
      {sp.link?.startsWith('criado_kv_') && <Banner kind="warn">Link salvo, mas NÃO publicado no KV ({sp.link.slice(10) === 'manual' ? 'configure o KV do encurtador na credencial Cloudflare' : 'falha na API da Cloudflare'}). Publique manualmente ou ajuste a credencial.</Banner>}
      {sp.link === 'slug_invalido' && <Banner kind="err">Slug inválido — use minúsculas, números e hífen (2-60 chars).</Banner>}
      {sp.link === 'url_invalida' && <Banner kind="err">URL de destino inválida — precisa ser https://.</Banner>}
      {sp.link === 'slug_existe' && <Banner kind="err">Já existe um link com esse slug neste projeto.</Banner>}
      {sp.link === 'removido' && <Banner kind="warn">Link removido.</Banner>}
      {sp.teste && (
        <Banner kind={sp.teste_ok === '1' ? 'ok' : 'err'}>
          <b>{PROVIDER_LABEL[sp.teste as IntegrationProvider] ?? sp.teste}</b> — {sp.teste_ok === '1' ? '✅ ' : '❌ '}{sp.teste_msg}
        </Banner>
      )}
      {sp.meta_acc === 'ok' && <Banner kind="ok">Conta Meta vinculada a este projeto.</Banner>}
      {sp.meta_acc === 'removido' && <Banner kind="warn">Conta Meta desvinculada.</Banner>}
      {sp.meta_acc === 'invalido' && <Banner kind="err">ID de conta inválido — use só os dígitos (ex: 111111111111111), sem o &quot;act_&quot;.</Banner>}
      {sp.meta_acc === 'erro' && <Banner kind="err">Falha ao salvar a conta Meta. Tente de novo.</Banner>}

      {/* Editar nome/logo do projeto */}
      <form action={updateWorkspaceAction} className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="workspace_id" value={id} />
        <label className="flex-1 min-w-[180px]">
          <span className="text-xs text-gray-400">Nome</span>
          <input name="nome" defaultValue={ws.nome} maxLength={120}
            className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
        </label>
        <label className="flex-1 min-w-[180px]">
          <span className="text-xs text-gray-400">URL do logo</span>
          <input name="logo_url" defaultValue={logoUrl} maxLength={500} placeholder="https://…/logo.png"
            className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white focus:border-blue-500 outline-none" />
        </label>
        <button type="submit" className="rounded-md bg-white/10 hover:bg-white/15 border border-white/10 px-3 py-2 text-sm text-white">Salvar</button>
      </form>

      {/* Checklist de onboarding */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-semibold">Checklist de onboarding</h2>
          {requiredPending === 0
            ? <span className="text-[11px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded px-1.5 py-0.5">pronto pra operar</span>
            : <span className="text-[11px] text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded px-1.5 py-0.5">{requiredPending} pendente(s)</span>}
        </div>
        {isLst && <p className="text-[11px] text-gray-500 mb-2">Projeto DEMO (legado): as integrações vêm das variáveis de ambiente — já está operando.</p>}
        <div className="divide-y divide-[#1F2937]">
          {checklist.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5 py-2">
              {c.done
                ? <Check size={16} className="text-emerald-400 mt-0.5 shrink-0" />
                : <Circle size={16} className={`${c.optional ? 'text-gray-600' : 'text-amber-400'} mt-0.5 shrink-0`} />}
              <div className="min-w-0">
                <div className={`text-sm ${c.done ? 'text-gray-200' : 'text-gray-300'}`}>{c.label}</div>
                {c.done
                  ? c.extra && <div className="text-[11px] text-gray-500">{c.extra}</div>
                  : c.todo && <div className="text-[11px] text-gray-500">{c.todo}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contas Orgânicas — conexão via OAuth (YouTube/Instagram/TikTok) */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-white font-semibold flex items-center gap-2"><Plug size={15} /> Contas Orgânicas</h2>
          {organicAccounts.length > 0 && (
            <form action={syncOrganicNowAction}>
              <input type="hidden" name="workspace_id" value={id} />
              <SubmitButton
                pendingLabel="Sincronizando… (até ~50s)"
                className="rounded-md border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 px-2.5 py-1 text-xs hover:bg-cyan-500/20"
              >
                <RefreshCw size={12} /> Sincronizar agora
              </SubmitButton>
            </form>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Conecte os canais/perfis do projeto — o dono autoriza na plataforma e os tokens ficam cifrados.
          Os dados alimentam a área <b className="text-gray-300">Orgânico</b> do dashboard.
        </p>

        {organicAccounts.length > 0 && (
          <div className="divide-y divide-[#1F2937] mb-3">
            {organicAccounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2 gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  {a.avatar_url
                    ? <img src={a.avatar_url} alt="" className="w-7 h-7 rounded-full shrink-0" />
                    : <span className="w-7 h-7 rounded-full bg-white/10 grid place-items-center shrink-0">{platformIcon(a.platform)}</span>}
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200 truncate flex items-center gap-1.5">
                      {platformIcon(a.platform)} {a.display_name || a.handle || a.external_id}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {a.status === 'token_expired'
                        ? <span className="text-rose-400">token expirado — reconecte</span>
                        : a.last_error
                        ? <span className="text-amber-400">{a.last_error.slice(0, 80)}</span>
                        : a.last_sync_at
                        ? `último sync ${fmt(a.last_sync_at)}`
                        : 'aguardando primeiro sync'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.status === 'token_expired' && PROVIDER_OAUTH[a.platform as IntegrationProvider] && (
                    <a href={`${PROVIDER_OAUTH[a.platform as IntegrationProvider]!.startPath}?ws=${id}`}
                      className="text-xs rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2.5 py-1 hover:bg-amber-500/20">
                      reconectar
                    </a>
                  )}
                  <form action={disconnectOrganicAccountAction}>
                    <input type="hidden" name="workspace_id" value={id} />
                    <input type="hidden" name="account_id" value={a.id} />
                    <button type="submit" className="text-xs rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 px-2.5 py-1 hover:bg-rose-500/20">
                      desconectar
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <a href={`/api/oauth/youtube/start?ws=${id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-sm font-medium text-white">
            <SquarePlay size={15} /> Conectar YouTube
          </a>
          <a href={`/api/oauth/instagram/start?ws=${id}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 px-3 py-1.5 text-sm font-medium text-white">
            <Camera size={15} /> Conectar Instagram (OAuth)
          </a>
          <form action={connectInstagramViaSystemUserAction}>
            <input type="hidden" name="workspace_id" value={id} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 px-3 py-1.5 text-sm font-medium text-fuchsia-300"
              title="Usa o token do Meta Ads (System User) já configurado — sem OAuth, tokens não expiram">
              <Camera size={15} /> Instagram via System User
            </button>
          </form>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-gray-500 cursor-not-allowed" title="Aguardando aprovação do app na TikTok for Business">
            <Music2 size={15} /> TikTok (aguardando aprovação)
          </span>
        </div>
        <p className="text-[11px] text-gray-600 mt-2">{PROVIDER_OAUTH.youtube?.hint}</p>
      </div>

      <div className="space-y-4 mt-4">
        {PROVIDER_ORDER.filter((p) => !PROVIDER_OAUTH[p]).map((provider) => {
          const fields = PROVIDER_FIELDS[provider]
          const status = byProvider.get(provider)
          return (
            <div key={provider} className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white font-semibold flex items-center gap-2">
                  {PROVIDER_LABEL[provider]}
                  {status && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded px-1.5 py-0.5">
                      <Check size={11} /> configurado
                    </span>
                  )}
                </h2>
                {status && (
                  <span className="text-[11px] text-gray-500">atualizado {fmt(status.updated_at)}</span>
                )}
              </div>

              <form action={saveCredentialAction} className="space-y-2.5">
                <input type="hidden" name="workspace_id" value={id} />
                <input type="hidden" name="provider" value={provider} />
                {fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs text-gray-400">
                      {f.label}{f.required && <span className="text-rose-400"> *</span>}
                      {f.secret && <span className="text-gray-600"> · write-only</span>}
                    </span>
                    {f.textarea ? (
                      <textarea
                        name={f.key}
                        rows={3}
                        autoComplete="off"
                        placeholder={status ? '•••••• (preenchido — deixe vazio p/ manter)' : (f.placeholder ?? '')}
                        className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white font-mono focus:border-blue-500 outline-none"
                      />
                    ) : (
                      <input
                        type={f.secret ? 'password' : 'text'}
                        name={f.key}
                        autoComplete="off"
                        placeholder={status && f.secret ? '•••••• (preenchido — deixe vazio p/ manter)' : (f.placeholder ?? '')}
                        className="mt-1 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-3 py-2 text-sm text-white focus:border-blue-500 outline-none"
                      />
                    )}
                  </label>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">
                    Salvar
                  </button>
                </div>
              </form>

              {status && (
                <div className="mt-2 flex items-center gap-4">
                  <form action={testCredentialAction}>
                    <input type="hidden" name="workspace_id" value={id} />
                    <input type="hidden" name="provider" value={provider} />
                    <button type="submit" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                      <Zap size={12} /> testar conexão
                    </button>
                  </form>
                  <DeleteCredentialButton workspaceId={id} provider={provider} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Contas de anúncio Meta vinculadas a este projeto */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4">
        <h2 className="text-white font-semibold mb-1">Contas de anúncio Meta</h2>
        <p className="text-xs text-gray-500 mb-3">
          Liga as contas de anúncio (act_XXXX) do cliente a este projeto — é o que atribui cada anúncio/criativo ao
          projeto certo. Use os mesmos IDs que você colocou em <b className="text-gray-300">accountIds</b> na credencial do Meta acima.
        </p>

        <form action={addMetaAccountAction} className="flex flex-wrap items-end gap-2 mb-3">
          <input type="hidden" name="workspace_id" value={id} />
          <label className="w-56">
            <span className="text-[11px] text-gray-400">ID da conta (só dígitos)</span>
            <input name="account_id" placeholder="111111111111111" inputMode="numeric"
              className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white font-mono outline-none focus:border-blue-500" />
          </label>
          <label className="flex-1 min-w-[160px]">
            <span className="text-[11px] text-gray-400">Rótulo (opcional)</span>
            <input name="rotulo" placeholder="ex: Conta principal"
              className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
          </label>
          <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">Vincular conta</button>
        </form>

        {metaAccounts.length > 0 ? (
          <div className="divide-y divide-[#1F2937]">
            {metaAccounts.map((a) => (
              <div key={a.account_id} className="flex items-center justify-between py-2 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-gray-200 font-mono text-xs truncate">act_{a.account_id}</div>
                  {a.rotulo && <div className="text-[11px] text-gray-500 truncate">{a.rotulo}</div>}
                </div>
                <form action={removeMetaAccountAction} className="shrink-0">
                  <input type="hidden" name="workspace_id" value={id} />
                  <input type="hidden" name="account_id" value={a.account_id} />
                  <button type="submit" className="text-xs text-rose-400/80 hover:text-rose-400">desvincular</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">{isLst ? 'O DEMO resolve as contas pela variável de ambiente — vincular aqui é opcional.' : 'Nenhuma conta vinculada ainda.'}</p>
        )}
      </div>

      {/* Links rastreáveis do orgânico — encurtador no domínio do cliente */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4">
        <h2 className="text-white font-semibold mb-1">Links rastreáveis (Orgânico)</h2>
        <p className="text-xs text-gray-500 mb-3">
          Cada link vive no domínio do cliente{linksDomain ? <> (<span className="text-gray-300">{linksDomain}/&#123;slug&#125;</span>)</> : ' (configure "Links Orgânico" na credencial Cloudflare)'} e
          redireciona carimbando <span className="font-mono text-gray-400">utm_source=organico</span> + <span className="font-mono text-gray-400">utm_content=post</span> + sck —
          é o que liga venda da Hotmart ao post.
        </p>

        <form action={createOrganicLinkAction} className="flex flex-wrap items-end gap-2 mb-3">
          <input type="hidden" name="workspace_id" value={id} />
          <label className="w-32">
            <span className="text-[11px] text-gray-400">Slug</span>
            <input name="slug" placeholder="bio-ig" className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
          </label>
          <label className="flex-1 min-w-[220px]">
            <span className="text-[11px] text-gray-400">Destino (https)</span>
            <input name="destination_url" placeholder="https://example.com/p/col-pv01/" className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
          </label>
          <label className="w-32">
            <span className="text-[11px] text-gray-400">Plataforma</span>
            <select name="platform" className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white outline-none">
              <option value="">—</option>
              <option value="youtube">YouTube</option>
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
            </select>
          </label>
          <label className="w-44">
            <span className="text-[11px] text-gray-400">Post (external_id, opcional)</span>
            <input name="post_external_id" placeholder="liga venda ao post" className="mt-0.5 w-full rounded-md bg-[#0B1120] border border-[#1F2937] px-2 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
          </label>
          <button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-sm font-medium text-white">Criar link</button>
        </form>

        {organicLinks.length > 0 && (
          <div className="divide-y divide-[#1F2937]">
            {organicLinks.map((l) => (
              <div key={l.id} className="flex items-center justify-between py-2 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-gray-200 font-mono text-xs truncate">
                    {linksDomain ? `${linksDomain}/${l.slug}` : `/${l.slug}`}
                    {l.platform && <span className="ml-2 text-[10px] rounded bg-white/5 border border-white/10 px-1 py-0.5 text-gray-400">{l.platform}</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">→ {l.destination_url}{l.post_external_id ? ` · post ${l.post_external_id}` : ''}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400">{l.clicks} cliques</span>
                  <form action={deleteOrganicLinkAction}>
                    <input type="hidden" name="workspace_id" value={id} />
                    <input type="hidden" name="link_id" value={l.id} />
                    <button type="submit" className="text-xs text-rose-400/80 hover:text-rose-400">remover</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usuários com acesso a este projeto */}
      <div className="rounded-xl border border-[#1F2937] bg-[#0F172A] p-4 mt-4">
        <h2 className="text-white font-semibold mb-1">Usuários com acesso</h2>
        <p className="text-xs text-gray-500 mb-3">Admins veem todos os projetos. Para um viewer enxergar este projeto, dê acesso abaixo.</p>
        <div className="divide-y divide-[#1F2937]">
          {users.map((u) => {
            const isAdmin = u.role === 'admin'
            const isMember = memberEmails.has(u.email)
            return (
              <div key={u.email} className="flex items-center justify-between py-2 gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-gray-200 truncate">{u.name || u.email}</div>
                  <div className="text-[11px] text-gray-500 truncate">{u.email}</div>
                </div>
                {isAdmin ? (
                  <span className="text-[11px] text-cyan-400 shrink-0">vê todos (admin)</span>
                ) : (
                  <form action={setMembershipAction} className="shrink-0">
                    <input type="hidden" name="workspace_id" value={id} />
                    <input type="hidden" name="user_email" value={u.email} />
                    <input type="hidden" name="op" value={isMember ? 'remove' : 'add'} />
                    <button type="submit" className={isMember
                      ? 'text-xs rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 px-2.5 py-1 hover:bg-rose-500/20'
                      : 'text-xs rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-2.5 py-1 hover:bg-emerald-500/20'}>
                      {isMember ? 'remover acesso' : 'dar acesso'}
                    </button>
                  </form>
                )}
              </div>
            )
          })}
          {users.length === 0 && <p className="text-sm text-gray-500 py-2">Nenhum usuário.</p>}
        </div>
      </div>
    </div>
  )
}

function platformIcon(platform: string) {
  if (platform === 'youtube') return <SquarePlay size={13} className="text-rose-400 shrink-0" />
  if (platform === 'instagram') return <Camera size={13} className="text-fuchsia-400 shrink-0" />
  if (platform === 'tiktok') return <Music2 size={13} className="text-cyan-400 shrink-0" />
  return null
}

function Banner({ kind, children }: { kind: 'ok' | 'warn' | 'err'; children: React.ReactNode }) {
  const cls = kind === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : kind === 'warn'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  return <div className={`mb-2 rounded-lg border px-4 py-2 text-sm ${cls}`}>{children}</div>
}
