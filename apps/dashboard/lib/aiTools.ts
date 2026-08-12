/**
 * Tools agênticas do chat (Equipe AGE). Hoje: aplicar_tag — o dono pede em
 * linguagem natural ("marca esses como campeão") e o modelo chama a função com os
 * ad_id do contexto. Grava com source='equipe' (distinta da tag manual/odin).
 * Só roda no Gemini (function-calling); o bridge do Claude é texto-só.
 */
import { SchemaType } from '@google/generative-ai'
import type { AgenticTool, ToolExecutor } from '@/lib/gemini'
import { createTag, applyTags } from '@/lib/creativeTags'

export const TAG_TOOL: AgenticTool = {
  name: 'aplicar_tag',
  description:
    'Aplica UMA tag a um ou mais anúncios de uma vez. Use quando o usuário pedir para marcar/taggear/rotular anúncios. ' +
    'Os ad_id DEVEM vir do contexto (campo ad_id dos top_ads, ou o ad_id do criativo em foco). Cria a tag automaticamente se não existir.',
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      tag_label: { type: SchemaType.STRING, description: 'Nome da tag (ex.: "campeão", "escalar", "pausar")' },
      tag_color: { type: SchemaType.STRING, description: 'Cor hex opcional (ex.: "#22c55e")' },
      ad_ids: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: 'Lista de ad_id a marcar (retirados do contexto)',
      },
    },
    required: ['tag_label', 'ad_ids'],
  },
}

/** Executor ligado ao workspace + quem pediu. Escreve a tag (source='equipe'). */
export function makeTagExecutor(workspaceId: string, byEmail: string | null): ToolExecutor {
  return async (name, args) => {
    if (name !== 'aplicar_tag') return { error: `tool desconhecida: ${name}` }
    const label = typeof args.tag_label === 'string' ? args.tag_label.trim() : ''
    const adIds = Array.isArray(args.ad_ids)
      ? args.ad_ids.map((v) => String(v).trim()).filter(Boolean)
      : []
    if (!label) return { error: 'tag_label vazio' }
    if (!adIds.length) return { error: 'nenhum ad_id informado' }
    const color = typeof args.tag_color === 'string' && args.tag_color.trim() ? args.tag_color.trim() : null

    const tag = await createTag(workspaceId, label, { namespace: 'equipe', color, createdBy: byEmail ?? 'equipe' })
    if (!tag) return { error: 'falha ao criar/achar a tag' }
    const n = await applyTags(workspaceId, [tag.id], adIds, { source: 'equipe', assignedBy: byEmail ?? 'equipe' })
    return { ok: true, tag: tag.label, anuncios_marcados: n }
  }
}
