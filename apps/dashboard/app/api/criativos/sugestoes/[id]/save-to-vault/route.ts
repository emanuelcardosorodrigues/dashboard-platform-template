/**
 * POST /api/criativos/sugestoes/[id]/save-to-vault
 *   body opcional: { tags?: string[], domains?: string[], kind?: VaultKind }
 *
 * Salva o brief de uma sugestão (novo_brief / lateralizar / congruencia_fix)
 * no mind-vault como nota reutilizável, SEM mudar o status da sugestão.
 *
 * Fluxo típico: user clica "Salvar no Vault" no modal de brief antes de
 * implementar — guarda o gancho pra reusar. Depois clica "Marcar feito".
 *
 * Não confundir com tipo 'vault_save' (sugestão própria do Gemini sobre
 * padrão recorrente). Este endpoint é DERIVADO de outros tipos.
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveWorkspaceFromRequest } from '@/lib/criativo-pipeline'
import { saveNote, MindVaultError, type VaultKind } from '@/lib/mind-vault'
import { log } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function supa() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

const TIPOS_VALIDOS = ['novo_brief', 'lateralizar', 'congruencia_fix'] as const
type TipoValido = (typeof TIPOS_VALIDOS)[number]

const KIND_POR_TIPO: Record<TipoValido, VaultKind> = {
  novo_brief: 'pattern',
  lateralizar: 'pattern',
  congruencia_fix: 'insight',
}

interface Body {
  tags?: string[]
  domains?: string[]
  kind?: VaultKind
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Body

  try {
    const client = supa()
    const { id: workspaceId } = await resolveWorkspaceFromRequest(client, req)

    const { data: sug, error: sErr } = await client
      .from('criativo_sugestoes')
      .select('id, tipo, ad_id, payload')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
    if (!sug) return NextResponse.json({ error: 'sugestão não encontrada' }, { status: 404 })

    if (!TIPOS_VALIDOS.includes(sug.tipo as TipoValido)) {
      return NextResponse.json(
        { error: `tipo '${sug.tipo}' não tem brief pra salvar (esperado: ${TIPOS_VALIDOS.join('/')})` },
        { status: 422 },
      )
    }

    const payload = (sug.payload ?? {}) as {
      titulo?: string
      motivo?: string
      brief?: string
      referencia_ad_id?: string
      observacao?: string
    }
    if (!payload.brief || payload.brief.trim().length === 0) {
      return NextResponse.json({ error: 'sugestão sem payload.brief' }, { status: 422 })
    }

    const tituloBase = payload.titulo?.trim() || sug.tipo
    const title = truncate(`Brief [${sug.tipo}] — ${tituloBase}`, 140)
    const tldr = truncate(payload.motivo?.trim() || `Brief derivado de sugestão ${sug.tipo}.`, 200)

    const bodyParts = [
      `Tipo: ${sug.tipo}`,
      payload.motivo ? `Motivo: ${payload.motivo}` : '',
      payload.referencia_ad_id || sug.ad_id ? `Referência ad_id: ${payload.referencia_ad_id ?? sug.ad_id}` : '',
      '',
      '## Brief',
      payload.brief.trim(),
      payload.observacao ? `\n## Observação\n${payload.observacao}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const kind = body.kind ?? KIND_POR_TIPO[sug.tipo as TipoValido]
    const domains = body.domains && body.domains.length > 0 ? body.domains : ['criativos']
    const tags = [...new Set([sug.tipo, 'brief-derivado', ...(body.tags ?? [])])]

    const { id: vaultNoteId } = await saveNote({ title, body: bodyParts, tldr, domains, kind, tags })

    return NextResponse.json({ sugestaoId: id, vaultNoteId, title, kind, domains })
  } catch (err) {
    if (err instanceof MindVaultError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    log.error('save-to-vault failed', { id, msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
