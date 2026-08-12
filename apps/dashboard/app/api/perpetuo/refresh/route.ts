/**
 * POST /api/perpetuo/refresh — "Atualizar": revalida os caches de dados (Meta,
 * transações, ficha, funis, vTurb) pra a próxima leitura vir fresca do banco.
 * NÃO dispara sync na API do Meta (isso roda de hora em hora no cron; puxar da
 * API pelo browser arriscaria rate-limit e timeout). Requer sessão.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const auth = await requireAuth(req, client)
  if ('error' in auth) return auth.error

  // Mesmos perfis de cache que os writers usam (Next 16: 2º arg é o profile).
  try { revalidateTag('sb-meta-ads', 'max') } catch {}
  try { revalidateTag('sb-transacoes', 'max') } catch {}
  try { revalidateTag('sb-funis', 'max') } catch {}
  try { revalidateTag('sb-qualificacao', { expire: 0 }) } catch {}
  try { revalidateTag('sb-vturb', { expire: 0 }) } catch {}

  return NextResponse.json({ ok: true })
}
