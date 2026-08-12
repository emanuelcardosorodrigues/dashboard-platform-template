/**
 * Pipeline de análise de criativo — extraído pra ser usado pelo route handler
 * e pelo cron sem duplicar código.
 *
 * Fluxo:
 *   1. getAdCreativeAssets — pega videoUrl/thumbnail/copy do Meta Graph
 *   2. Marca status='running' pra evitar dois workers concorrentes
 *   3. analyzeCreative (Gemini multimodal)
 *   4. Cache check por video_hash (skip se mesmo binário e já 'ok' e !force)
 *   5. Embedding do resumo (não-fatal)
 *   6. Upsert em criativo_analise
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdCreativeAssets, MetaGraphError } from './meta-graph'
import { analyzeCreative, generateEmbedding } from './gemini'
import { persistThumbnail } from './criativo-thumbnail'
import { persistVideo } from './criativo-video'
import type { WorkspaceContext } from './prompts/criativo-analise-v1'
import { log } from './log'

export interface AnalyzeAdResult {
  adId: string
  workspaceId: string
  status: 'ok' | 'cached' | 'failed' | 'no-asset'
  video_hash?: string | null
  one_belief_score?: number | null
  embedded?: boolean
  modelo?: string
  prompt_version?: string
  tokens_input?: number | null
  tokens_output?: number | null
  error?: string
  duration_ms: number
}

export async function runAnalysisForAd(opts: {
  supa: SupabaseClient
  workspaceId: string
  workspaceCtx: WorkspaceContext
  adId: string
  force?: boolean
  /** Anúncio de imagem (ou vídeo sem transcrição): classifica pela imagem + copy. */
  imageOnly?: boolean
}): Promise<AnalyzeAdResult> {
  const { supa, workspaceId, workspaceCtx, adId, force = false, imageOnly = false } = opts
  const startedAt = Date.now()

  // 1. Assets
  let assets: Awaited<ReturnType<typeof getAdCreativeAssets>>
  try {
    assets = await getAdCreativeAssets(adId)
  } catch (err) {
    if (err instanceof MetaGraphError) {
      return { adId, workspaceId, status: 'failed', error: err.message, duration_ms: Date.now() - startedAt }
    }
    throw err
  }
  if (!assets.videoUrl && !assets.thumbnailUrl) {
    return { adId, workspaceId, status: 'no-asset', error: 'sem videoUrl nem thumbnailUrl', duration_ms: Date.now() - startedAt }
  }

  // 2. ad_name (best-effort)
  const { data: adRow } = await supa
    .from('meta_ads')
    .select('ad_name')
    .eq('ad_id', adId)
    .limit(1)
    .maybeSingle()
  const adName: string | null = adRow?.ad_name ?? null

  // 2b. Mídia já processada pela VPS (transcrição Whisper + frames). Se existir,
  // a classificação roda sobre TEXTO+frames (não re-baixa o vídeo no Gemini →
  // sem teto de 20MB, sem custo de re-transcrição, e preserva o Whisper).
  const { data: midiaRow } = await supa
    .from('criativo_analise')
    .select('transcricao, frames_path, padroes_detectados')
    .eq('workspace_id', workspaceId)
    .eq('ad_id', adId)
    .maybeSingle()
  const transcricaoVps: string | null = midiaRow?.transcricao ?? null
  const duracaoVps = (midiaRow?.padroes_detectados as Record<string, unknown> | null)?.duracao_segundos
  const framesVps: string[] = (() => {
    try {
      const arr = JSON.parse(midiaRow?.frames_path ?? 'null')
      return Array.isArray(arr) ? arr.map((f) => f?.url).filter((u: unknown): u is string => typeof u === 'string') : []
    } catch {
      return []
    }
  })()
  // Thumbnail: 1º frame da VPS (já no nosso Storage) é a melhor opção. Sem frames
  // (anúncio de imagem, ou vídeo que a VPS não processou), a thumb do Meta vem numa
  // URL fbcdn ASSINADA que morre em ~2 semanas — então copia pro Storage antes de
  // gravar. Só cai na URL do Meta se a cópia falhar: prévia temporária > prévia
  // nenhuma, e o backfill-thumbs recupera depois.
  const thumbFinal: string | null =
    framesVps[0] ?? (await persistThumbnail(supa, adId, assets.thumbnailUrl)) ?? assets.thumbnailUrl
  // mp4 no nosso bucket (a URL fbcdn expira em ~2 semanas). Fallback: URL crua.
  const videoFinal: string | null = (await persistVideo(supa, adId, assets.videoUrl)) ?? assets.videoUrl

  // 3. Marca running
  await supa
    .from('criativo_analise')
    .upsert(
      {
        workspace_id: workspaceId,
        ad_id: adId,
        ad_name: adName,
        video_url: videoFinal,
        thumbnail_url: thumbFinal,
        instagram_permalink_url: assets.instagramPermalinkUrl,
        status: 'running',
        error_message: null,
        modelo: 'pending',
        prompt_version: 'pending',
      },
      { onConflict: 'workspace_id,ad_id' }
    )

  // 4. Gemini multimodal
  let result: Awaited<ReturnType<typeof analyzeCreative>>
  try {
    result = await analyzeCreative({
      videoUrl: assets.videoUrl,
      thumbnailUrl: assets.thumbnailUrl,
      copy: assets.copy,
      workspace: workspaceCtx,
      transcricao: transcricaoVps,
      frames: framesVps,
      imageOnly,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('analyzeCreative failed', { adId, msg })
    await supa
      .from('criativo_analise')
      .update({ status: 'failed', error_message: msg })
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
    return { adId, workspaceId, status: 'failed', error: msg, duration_ms: Date.now() - startedAt }
  }

  // 5. Cache hit por video_hash (a análise rodou, mas se o hash bate com cache prévio podemos preservar gerado_at)
  if (!force && result.video_hash) {
    const { data: cached } = await supa
      .from('criativo_analise')
      .select('video_hash, status')
      .eq('workspace_id', workspaceId)
      .eq('ad_id', adId)
      .maybeSingle()
    if (cached?.video_hash === result.video_hash && cached?.status === 'ok') {
      await supa
        .from('criativo_analise')
        .update({ status: 'ok', error_message: null })
        .eq('workspace_id', workspaceId)
        .eq('ad_id', adId)
      return {
        adId,
        workspaceId,
        status: 'cached',
        video_hash: result.video_hash,
        duration_ms: Date.now() - startedAt,
      }
    }
  }

  // 6. Embedding (não-fatal)
  let embedding: number[] | null = null
  try {
    const seed = [result.resumo, result.hook_descricao].filter(Boolean).join('\n')
    if (seed) embedding = await generateEmbedding(seed)
  } catch (err) {
    log.warn('embedding falhou (continua sem)', { adId, msg: err instanceof Error ? err.message : err })
  }

  // Preserva a duração (ffprobe da VPS) através da classificação — a IA não a
  // produz; o corte "Duração" dos Padrões depende dela.
  if (typeof duracaoVps === 'number') {
    result.padroes_detectados = { ...(result.padroes_detectados ?? {}), duracao_segundos: duracaoVps }
  }

  // 7. Upsert final
  const { error: upErr } = await supa
    .from('criativo_analise')
    .upsert(
      {
        workspace_id: workspaceId,
        ad_id: adId,
        ad_name: adName,
        video_url: videoFinal,
        video_hash: result.video_hash,
        thumbnail_url: thumbFinal,
        instagram_permalink_url: assets.instagramPermalinkUrl,
        transcricao: result.transcricao,
        resumo: result.resumo,
        hook_descricao: result.hook_descricao,
        hook_tipo: result.hook_tipo,
        angulo_copy: result.angulo_copy,
        formato_visual: result.formato_visual,
        elementos_visuais: result.elementos_visuais,
        cta: result.cta,
        producao: result.producao,
        nivel_consciencia: result.nivel_consciencia || null,
        momento_funil: result.momento_funil || null,
        promessa_principal: result.promessa_principal || null,
        one_belief_score: result.one_belief_score,
        one_belief_desvio: result.one_belief_desvio,
        estrutura_roteiro: result.estrutura_roteiro,
        embedding: embedding ? `[${embedding.join(',')}]` : null,
        padroes_detectados: result.padroes_detectados,
        modelo: result.modelo,
        prompt_version: result.prompt_version,
        tokens_input: result.tokens_input,
        tokens_output: result.tokens_output,
        status: 'ok',
        error_message: null,
        gerado_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,ad_id' }
    )

  if (upErr) {
    log.error('criativo_analise upsert failed', { adId, msg: upErr.message })
    return { adId, workspaceId, status: 'failed', error: upErr.message, duration_ms: Date.now() - startedAt }
  }

  return {
    adId,
    workspaceId,
    status: 'ok',
    video_hash: result.video_hash,
    one_belief_score: result.one_belief_score,
    embedded: !!embedding,
    modelo: result.modelo,
    prompt_version: result.prompt_version,
    tokens_input: result.tokens_input,
    tokens_output: result.tokens_output,
    duration_ms: Date.now() - startedAt,
  }
}

/**
 * Análise de um ASSET SOLTO da biblioteca (sem ad_id real, sem copy, sem transcrição
 * VPS): classifica direto pela mídia via Gemini (vídeo até ~20MB, ou imageOnly).
 * Grava em criativo_analise com rodou=false, fonte='biblioteca'. asset_key sintético.
 */
export async function runAnalysisForLibraryAsset(opts: {
  supa: SupabaseClient
  workspaceId: string
  workspaceCtx: WorkspaceContext
  assetKey: string
  nome: string | null
  videoUrl: string | null
  thumbnailUrl: string | null
}): Promise<AnalyzeAdResult> {
  const { supa, workspaceId, workspaceCtx, assetKey, nome, videoUrl, thumbnailUrl } = opts
  const startedAt = Date.now()
  if (!videoUrl && !thumbnailUrl) {
    return { adId: assetKey, workspaceId, status: 'no-asset', error: 'sem videoUrl nem thumbnailUrl', duration_ms: Date.now() - startedAt }
  }
  const imageOnly = !videoUrl

  // Asset da biblioteca também chega com thumb fbcdn assinada (expira em ~2 semanas):
  // copia pro Storage antes de gravar. `thumbnailUrl` cru segue pro Gemini abaixo —
  // ele lê na hora, então não depende da cópia ter dado certo.
  const thumbFinal: string | null = (await persistThumbnail(supa, assetKey, thumbnailUrl)) ?? thumbnailUrl
  const videoFinal: string | null = (await persistVideo(supa, assetKey, videoUrl)) ?? videoUrl

  await supa.from('criativo_analise').upsert(
    {
      workspace_id: workspaceId, ad_id: assetKey, ad_name: nome,
      video_url: videoFinal, thumbnail_url: thumbFinal,
      rodou: false, fonte: 'biblioteca',
      status: 'running', error_message: null, modelo: 'pending', prompt_version: 'pending',
    },
    { onConflict: 'workspace_id,ad_id' },
  )

  let result: Awaited<ReturnType<typeof analyzeCreative>>
  try {
    result = await analyzeCreative({
      videoUrl, thumbnailUrl, copy: null, workspace: workspaceCtx,
      transcricao: null, frames: [], imageOnly,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('analyzeCreative (biblioteca) failed', { assetKey, msg })
    await supa.from('criativo_analise').update({ status: 'failed', error_message: msg })
      .eq('workspace_id', workspaceId).eq('ad_id', assetKey)
    return { adId: assetKey, workspaceId, status: 'failed', error: msg, duration_ms: Date.now() - startedAt }
  }

  let embedding: number[] | null = null
  try {
    const seed = [result.resumo, result.hook_descricao].filter(Boolean).join('\n')
    if (seed) embedding = await generateEmbedding(seed)
  } catch (err) {
    log.warn('embedding (biblioteca) falhou', { assetKey, msg: err instanceof Error ? err.message : err })
  }

  const { error: upErr } = await supa.from('criativo_analise').upsert(
    {
      workspace_id: workspaceId, ad_id: assetKey, ad_name: nome,
      video_url: videoFinal, video_hash: result.video_hash, thumbnail_url: thumbFinal,
      transcricao: result.transcricao, resumo: result.resumo,
      hook_descricao: result.hook_descricao, hook_tipo: result.hook_tipo,
      angulo_copy: result.angulo_copy, formato_visual: result.formato_visual,
      elementos_visuais: result.elementos_visuais, cta: result.cta, producao: result.producao,
      nivel_consciencia: result.nivel_consciencia || null, momento_funil: result.momento_funil || null,
      promessa_principal: result.promessa_principal || null,
      one_belief_score: result.one_belief_score, one_belief_desvio: result.one_belief_desvio,
      estrutura_roteiro: result.estrutura_roteiro,
      embedding: embedding ? `[${embedding.join(',')}]` : null,
      padroes_detectados: result.padroes_detectados,
      modelo: result.modelo, prompt_version: result.prompt_version,
      tokens_input: result.tokens_input, tokens_output: result.tokens_output,
      status: 'ok', error_message: null, rodou: false, fonte: 'biblioteca',
      gerado_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,ad_id' },
  )
  if (upErr) {
    return { adId: assetKey, workspaceId, status: 'failed', error: upErr.message, duration_ms: Date.now() - startedAt }
  }
  return {
    adId: assetKey, workspaceId, status: 'ok', video_hash: result.video_hash,
    one_belief_score: result.one_belief_score, embedded: !!embedding,
    modelo: result.modelo, prompt_version: result.prompt_version,
    tokens_input: result.tokens_input, tokens_output: result.tokens_output,
    duration_ms: Date.now() - startedAt,
  }
}

export interface ResolvedWorkspace {
  id: string
  ctx: WorkspaceContext
}

export async function resolveWorkspaceBySlug(supa: SupabaseClient, slug?: string): Promise<ResolvedWorkspace> {
  const s = slug ?? process.env.DEFAULT_WORKSPACE_SLUG ?? 'demo'
  const { data, error } = await supa
    .from('workspaces')
    .select('id, nome, one_belief, avatar_brief, vocabulario')
    .eq('slug', s)
    .single()
  if (error || !data) throw new Error(`workspace slug=${s} não encontrado: ${error?.message}`)
  return {
    id: data.id,
    ctx: {
      nome: data.nome,
      one_belief: data.one_belief,
      avatar_brief: data.avatar_brief,
      vocabulario: data.vocabulario ?? {},
    },
  }
}

/**
 * Resolve workspace lendo `?account_id=` direto da URL do request. Se
 * presente, delega pra resolveWorkspaceByAccountId; senão, faz fallback
 * pro slug default (single-tenant legacy).
 *
 * Helper canônico das rotas multi-tenant — toda nova rota de /criativos
 * deve usar este aqui em vez de resolveWorkspaceBySlug direto.
 */
export async function resolveWorkspaceFromRequest(
  supa: SupabaseClient,
  req: { url: string }
): Promise<ResolvedWorkspace> {
  const accountId = new URL(req.url).searchParams.get('account_id')
  if (accountId) return resolveWorkspaceByAccountId(supa, accountId)
  return resolveWorkspaceBySlug(supa)
}

/**
 * Resolve workspace via account_id do Meta. Lê workspace_meta_accounts;
 * se não encontrar mapeamento, faz fallback para resolveWorkspaceBySlug
 * (mantém compatibilidade com setups single-tenant que ainda usam slug).
 */
export async function resolveWorkspaceByAccountId(
  supa: SupabaseClient,
  accountId: string
): Promise<ResolvedWorkspace> {
  if (!accountId) throw new Error('account_id vazio')
  const cleaned = accountId.replace(/^act_/, '')
  const { data: link, error: linkErr } = await supa
    .from('workspace_meta_accounts')
    .select('workspace_id')
    .eq('account_id', cleaned)
    .maybeSingle()
  if (linkErr) throw new Error(`fetch workspace_meta_accounts: ${linkErr.message}`)
  if (!link) {
    // sem mapeamento → fallback p/ slug default (single-tenant legacy)
    return resolveWorkspaceBySlug(supa)
  }
  const { data, error } = await supa
    .from('workspaces')
    .select('id, nome, one_belief, avatar_brief, vocabulario')
    .eq('id', link.workspace_id)
    .single()
  if (error || !data) throw new Error(`workspace ${link.workspace_id} não encontrado: ${error?.message}`)
  return {
    id: data.id,
    ctx: {
      nome: data.nome,
      one_belief: data.one_belief,
      avatar_brief: data.avatar_brief,
      vocabulario: data.vocabulario ?? {},
    },
  }
}
