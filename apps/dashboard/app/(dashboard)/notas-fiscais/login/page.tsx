import { loginNfse } from './actions'

type NfseSearchParams = { erro?: string; min?: string; tentativas?: string }

export default function NfseLoginPage({ searchParams }: { searchParams: Promise<NfseSearchParams> }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0D1117]">
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-8 w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-white font-semibold text-lg">Notas Fiscais</h1>
          <p className="text-gray-500 text-sm mt-1">Acesso restrito — confirme suas credenciais</p>
        </div>

        <form action={loginNfse} className="space-y-4">
          <div>
            <label htmlFor="nfse-user" className="block text-xs text-gray-500 mb-1">E-mail</label>
            <input
              id="nfse-user"
              name="user"
              type="email"
              autoComplete="username"
              required
              autoFocus
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label htmlFor="nfse-pass" className="block text-xs text-gray-500 mb-1">Senha</label>
            <input
              id="nfse-pass"
              name="pass"
              type="password"
              autoComplete="current-password"
              required
              className="w-full bg-[#0D1117] border border-[#1F2937] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          <NfseErro searchParams={searchParams} />

          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium transition-colors"
          >
            Entrar
          </button>
        </form>
      </div>
    </div>
  )
}

async function NfseErro({ searchParams }: { searchParams: Promise<NfseSearchParams> }) {
  const { erro, min, tentativas } = await searchParams
  if (!erro) return null

  if (erro === 'locked') {
    const minutos = min || '15'
    return (
      <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
        Acesso bloqueado por muitas tentativas incorretas. Tente novamente em {minutos} minuto{minutos !== '1' ? 's' : ''}.
      </p>
    )
  }

  if (erro === 'throttled') {
    return (
      <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
        Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.
      </p>
    )
  }

  const restantes = tentativas ? 5 - parseInt(tentativas, 10) : null
  return (
    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
      E-mail ou senha incorretos.{restantes !== null && restantes > 0 ? ` ${restantes} tentativa${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}.` : ''}
    </p>
  )
}
