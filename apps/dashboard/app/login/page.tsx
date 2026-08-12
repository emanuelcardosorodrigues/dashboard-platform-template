import { loginAction } from './actions'

export const metadata = { title: 'Entrar — Dashboard Analytics Hub' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string; attempts?: string; min?: string }>
}) {
  const { error, from, attempts, min } = await searchParams
  const isLocked = error === 'locked'
  const remaining = attempts ? 5 - parseInt(attempts) : null

  return (
    <div className="min-h-screen bg-[#0A0F1E] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#06B6D4]/10 border border-[#06B6D4]/20 mb-4">
            <svg className="w-7 h-7 text-[#06B6D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white font-[family-name:var(--font-heading)]">
            Painel de Performance
          </h1>
          <p className="text-sm text-[#9CA3AF] mt-1">Equipe · Inteligência de Marketing</p>
        </div>

        <div className="bg-[#111827] border border-[#1F2937] rounded-2xl p-6">
          {isLocked ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#F43F5E]/10 mb-3">
                <svg className="w-5 h-5 text-[#F43F5E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <p className="text-[#F43F5E] font-medium text-sm">Acesso bloqueado</p>
              <p className="text-[#9CA3AF] text-xs mt-1">
                Muitas tentativas incorretas. Tente novamente em {min || 15} minuto{min !== '1' ? 's' : ''}.
              </p>
            </div>
          ) : (
            <form action={loginAction} className="space-y-4">
              <input type="hidden" name="from" value={from ?? '/'} />

              <div>
                <label htmlFor="email" className="block text-sm text-[#9CA3AF] mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  placeholder="voce@exemplo.com"
                  className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3 text-white placeholder-[#374151] text-sm focus:outline-none focus:border-[#06B6D4] focus:ring-1 focus:ring-[#06B6D4] transition-colors"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm text-[#9CA3AF] mb-1.5">
                  Senha
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-[#0A0F1E] border border-[#1F2937] rounded-xl px-4 py-3 text-white placeholder-[#374151] text-sm focus:outline-none focus:border-[#06B6D4] focus:ring-1 focus:ring-[#06B6D4] transition-colors"
                />
              </div>

              {error === '1' && (
                <p className="text-sm text-[#F43F5E] bg-[#F43F5E]/10 border border-[#F43F5E]/20 rounded-lg px-3 py-2">
                  Email ou senha incorretos.{remaining !== null && remaining > 0 ? ` ${remaining} tentativa${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.` : ''}
                </p>
              )}

              {error === 'no_access' && (
                <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  Sua conta ainda não tem permissão para nenhuma tela. Peça ao administrador para liberar acesso.
                </p>
              )}

              {error === 'session_expired' && (
                <p className="text-sm text-[#9CA3AF] bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  Sua sessão expirou. Faça login novamente.
                </p>
              )}

              {error === 'throttled' && (
                <p className="text-sm rounded-[12px] px-3 py-3" style={{ background: '#FEF3C7', color: '#92400E' }}>
                  Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.
                </p>
              )}

              <button
                type="submit"
                className="w-full bg-[#06B6D4] hover:bg-[#0891B2] text-white font-medium text-sm rounded-xl py-3 transition-colors"
              >
                Entrar
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
