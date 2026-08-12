'use server'

/**
 * Preferências POR USUÁRIO persistidas no servidor.
 *
 * Hoje guarda uma só: o preset de período padrão (`users.default_filters.periodo`).
 * Antes ele vivia em localStorage ('demo-default-date-preset'), ou seja, POR
 * DISPOSITIVO — e o PWA instalado tem storage próprio (no iOS, separado do
 * Safari). Resultado medido: desktop em "Tudo" e app em "30d" mostrando
 * faturamentos que diferiam 9,1x sem nenhum erro de conta. Com a preferência no
 * usuário, o mesmo login vê o mesmo período em qualquer aparelho.
 *
 * A coluna `default_filters` (jsonb) já existia e o campo `periodo` já era
 * normalizado em lib/sessions.ts — nada de tabela nova. Reaproveita o molde de
 * app/actions/calcPresets.ts: sessão pelo cookie, escrita via service_role,
 * escopo pelo `user_id` da sessão (nunca por id vindo do cliente).
 */

import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { SESSION_COOKIE } from '@/lib/auth'
import { lookupSession, invalidateSessionCache } from '@/lib/sessions'
import { isValidPresetLabel } from '@/lib/datePresets'

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function currentSession() {
  const id = (await cookies()).get(SESSION_COOKIE)?.value
  return id ? lookupSession(id) : null
}

// A LEITURA do preset não mora aqui: quem lê é o layout do dashboard, direto da
// sessão (app/(dashboard)/layout.tsx). Um `export` num arquivo 'use server' vira
// endpoint invocável de fora — não vale a pena manter um, sem consumidor, só
// porque a simetria com o `save` parece bonita.

/**
 * Grava o preset padrão do usuário. Faz MERGE no jsonb: `default_filters` também
 * carrega funil/conta/de/ate definidos pelo admin, e sobrescrever o objeto
 * inteiro apagaria esses campos calado.
 */
export async function saveDefaultPeriodoAction(
  label: string,
): Promise<{ ok: boolean; error?: string }> {
  const s = await currentSession()
  if (!s) return { ok: false, error: 'unauthorized' }
  if (!isValidPresetLabel(label)) return { ok: false, error: 'preset desconhecido' }

  const sb = supa()
  const { data, error: readErr } = await sb
    .from('users')
    .select('default_filters')
    .eq('id', s.user_id)
    .maybeSingle()
  if (readErr) return { ok: false, error: readErr.message }

  const atual = (data?.default_filters ?? {}) as Record<string, unknown>
  const { error } = await sb
    .from('users')
    .update({ default_filters: { ...atual, periodo: label }, updated_at: new Date().toISOString() })
    .eq('id', s.user_id)
  if (error) return { ok: false, error: error.message }

  // A sessão é cacheada por 30s em memória; sem isto o próximo load ainda leria
  // o preset antigo e o usuário veria a estrela "não colar".
  invalidateSessionCache(s.session_id)
  return { ok: true }
}
