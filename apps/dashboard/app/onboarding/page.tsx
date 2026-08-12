export const dynamic = 'force-dynamic'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'
import { completeOnboardingAction } from './actions'

export const metadata = { title: 'Primeiro acesso — Dashboard Analytics Hub' }

const ERROR_MESSAGES: Record<string, string> = {
  short: 'A nova senha precisa ter pelo menos 10 caracteres.',
  mismatch: 'A confirmação não bate com a nova senha.',
  same: 'A nova senha precisa ser diferente da atual.',
  wrong_current: 'Senha atual incorreta.',
  db: 'Erro ao salvar a nova senha.',
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string }>
}) {
  const { error, msg } = await searchParams
  const errorMessage = error ? (ERROR_MESSAGES[error] ?? 'Erro desconhecido.') : null

  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) redirect('/login')
  const session = await lookupSession(sessionId)
  if (!session) redirect('/login')
  if (session.status !== 'pending_onboarding') {
    redirect('/visao-geral')
  }

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
            <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white font-[family-name:var(--font-heading)]">
            Primeiro acesso
          </h1>
          <p className="text-sm text-[#9CA3AF] mt-1">
            Defina uma nova senha pra ativar sua conta.
          </p>
        </div>

        <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6">
          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
            Você está logado como <strong>{session.email}</strong>. Use a senha temporária que recebeu como senha atual.
          </div>

          {errorMessage && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
              {errorMessage}
              {msg && <span className="block text-xs text-rose-400/80 mt-1">{decodeURIComponent(msg)}</span>}
            </div>
          )}

          <form action={completeOnboardingAction} className="space-y-4">
            <div>
              <label htmlFor="current_password" className="block text-sm text-[#9CA3AF] mb-1.5">
                Senha atual (temporária)
              </label>
              <input
                id="current_password"
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
                className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3 text-white placeholder-[#374151] text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="new_password" className="block text-sm text-[#9CA3AF] mb-1.5">
                Nova senha (mín. 10 caracteres)
              </label>
              <input
                id="new_password"
                name="new_password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3 text-white placeholder-[#374151] text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>

            <div>
              <label htmlFor="confirm_password" className="block text-sm text-[#9CA3AF] mb-1.5">
                Confirmar nova senha
              </label>
              <input
                id="confirm_password"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                required
                className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3 text-white placeholder-[#374151] text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-medium text-sm rounded-xl py-3 transition-colors"
            >
              Ativar minha conta
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
