/**
 * Autenticação da EXTRAÇÃO de comentários (dados públicos do YouTube).
 *
 * Preferência: YOUTUBE_API_KEY (env) — commentThreads.list/comments.list exigem
 * o escopo OAuth youtube.force-ssl MESMO pra dados públicos, e a conexão OAuth
 * do dashboard (readonly+analytics, usada pelos crons) não o tem. Com API key
 * não há escopo envolvido e a conexão dos crons fica intocada.
 * Fallback: OAuth do workspace (funciona se o token tiver o escopo).
 */
import { getYoutubeConfig } from '@/lib/integrations/factory'
import { refreshAccessToken, type YtAuth } from './youtube'

export async function resolveExtracaoAuth(workspaceId: string): Promise<YtAuth | null> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim()
  if (apiKey) return { apiKey }

  const cfg = await getYoutubeConfig(workspaceId)
  const refreshToken = cfg ? (cfg.tokens['*'] ?? Object.values(cfg.tokens)[0]) : undefined
  if (!cfg || !refreshToken) return null
  const accessToken = await refreshAccessToken({
    clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken,
  })
  return { accessToken }
}
