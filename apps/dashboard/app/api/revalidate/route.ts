import { revalidateTag } from 'next/cache'
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession } from '@/lib/sessions'

export const dynamic = 'force-dynamic'

// Tags do cache de dados cru (ver lib/supabase.ts). Inclui presets/vTurb pra fases futuras.
const DATA_TAGS = ['sb-transacoes', 'sb-meta-ads', 'sb-qualificacao', 'sb-config', 'sb-column-presets', 'sb-vturb'] as const

// Antes: GET totalmente ABERTO (qualquer um bustava o cache). Agora exige
// Bearer CRON_SECRET (chamadas programáticas: webhook/cron) OU uma sessão válida
// (botão "Atualizar" no navegador).
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value
  if (!sessionId) return false
  return Boolean(await lookupSession(sessionId))
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // expire:0 = expiração IMEDIATA (forma suportada no Next 16 sem Cache Components;
  // revalidateTag(tag) de 1 arg está deprecado, e 'max' é stale-while-revalidate
  // que NÃO atualizaria na hora). Próximo render = cache miss bloqueante = fresco.
  for (const tag of DATA_TAGS) revalidateTag(tag, { expire: 0 })
  return NextResponse.json({ revalidated: true, tags: DATA_TAGS, ts: Date.now() })
}
