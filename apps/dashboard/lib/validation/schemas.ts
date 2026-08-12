import { z } from 'zod'

/**
 * Schemas Zod centralizados pras rotas /api/*.
 * Padrão: cada rota usa `parseBody(req, Schema)` (helper abaixo) que devolve
 * Result<T> com erro estruturado em mismatch. Endpoint responde 400 + lista de
 * issues sem vazar detalhe interno.
 */

// ---------- AI ----------
export const askBodySchema = z.object({
  question: z.string().trim().min(1, 'Pergunta vazia').max(1500, 'Pergunta muito longa'),
  pathname: z.string().max(200).optional(),
  searchParams: z.record(z.string(), z.string().max(200)).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(2000),
      }),
    )
    .max(20)
    .optional(),
  provider: z.enum(['gemini', 'claude']).optional(),
  model: z.string().max(40).optional(),
})

// Body vazio é permitido — default = ontem. Quando vier algo, valida formato.
export const regenerateBodySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').optional(),
})

// ---------- Quizzes ----------
const slugRegex = /^[a-z0-9][a-z0-9-]{1,63}$/

const quizStepSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(40),
}).passthrough()

const quizConfigSchema = z.object({
  steps: z.array(quizStepSchema).min(1, 'config.steps deve ter ao menos um item'),
}).passthrough()

export const quizCreateSchema = z.object({
  slug: z.string().regex(slugRegex, 'slug deve ser kebab-case (a-z, 0-9, hífen) entre 2 e 64 chars.'),
  title: z.string().trim().min(1, 'title obrigatório').max(200),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  config: quizConfigSchema,
  webhook_url: z.string().trim().url('webhook_url inválida').max(500).nullable().optional(),
})

export const quizUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
  config: quizConfigSchema.optional(),
  webhook_url: z.string().trim().url('webhook_url inválida').max(500).nullable().optional(),
}).refine(
  v => v.title !== undefined || v.status !== undefined || v.config !== undefined || v.webhook_url !== undefined,
  'Nenhum campo para atualizar.',
)

// ---------- Experimentos ----------
const variantSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'slug deve conter apenas letras minúsculas, números e hífen (sem underscore)'),
  url: z.string().url().max(500).optional(),
  weight: z.number().min(0).max(1),
  // Ausente = ativa (retrocompat). false = desativada: sai do sorteio, mas o
  // histórico é preservado e ela pode ser reativada.
  enabled: z.boolean().optional(),
})

export const experimentoCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  entry_path: z.string().min(1).max(200),
  type: z.enum(['page', 'checkout', 'ob']),
  variants: z.array(variantSchema).min(1),
  fallback_url: z.string().trim().url().max(500).optional(),
  scheduled_start: z.string().datetime({ offset: true }).optional(),
  scheduled_end: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['draft', 'active']).optional(),
  matrix: z.record(z.string(), z.string().max(500)).optional(),
  checkout_slug: z.string().max(80).optional(),
  vturb_enabled: z.boolean().optional(),
  auto_optimize: z.boolean().optional(),
  champion_variant: z.string().max(120).nullable().optional(),
  bandit_min_conv: z.number().int().min(1).max(10000).optional(),
})

export const experimentoDeleteSchema = z.object({
  id: z.string().min(1).max(80),
})

export const experimentoPatchSchema = z.object({
  id: z.string().min(1).max(80),
  status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
  matrix: z.record(z.string(), z.string().max(500)).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  variants: z.array(variantSchema).min(1).optional(),
  fallback_url: z.string().trim().max(500).nullable().optional(),
  checkout_slug: z.string().trim().max(80).nullable().optional(),
  vturb_enabled: z.boolean().optional(),
  auto_optimize: z.boolean().optional(),
  champion_variant: z.string().max(120).nullable().optional(),
  bandit_min_conv: z.number().int().min(1).max(10000).optional(),
}).refine(
  v => v.status !== undefined || v.matrix !== undefined || v.name !== undefined || v.variants !== undefined || v.fallback_url !== undefined || v.checkout_slug !== undefined || v.vturb_enabled !== undefined || v.auto_optimize !== undefined || v.champion_variant !== undefined || v.bandit_min_conv !== undefined,
  'Envie ao menos um campo para atualizar.',
)

// ---------- NFSe ----------
export const nfseEmitirSchema = z.object({
  transacao_id: z.union([z.string(), z.number()]).optional(),
  hotmart_id: z.string().max(60).optional(),
  destinatario: z.object({
    nome: z.string().min(1).max(200),
    cpf: z.string().regex(/^\d{11}$/).optional(),
    cnpj: z.string().regex(/^\d{14}$/).optional(),
    email: z.string().email().max(200),
  }).optional(),
}).passthrough()

export const nfseCancelarSchema = z.object({
  motivo: z.string().trim().min(5, 'motivo deve ter ao menos 5 chars').max(300),
})

// ---------- Admin ----------
export const backfillSckQuerySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve ser YYYY-MM-DD').optional(),
})

// ---------- Webhook Hotmart ----------
// Shape conservador: validamos só o esqueleto mínimo. Resto é passthrough porque
// Hotmart envia mais campos do que precisamos consumir e o payload muda entre
// versões. Foco aqui é defender contra `data` ausente ou tipo errado.
export const hotmartWebhookSchema = z.object({
  event: z.string().min(1).max(120),
  data: z.object({
    purchase: z.object({
      transaction: z.union([z.string(), z.number()]).optional(),
      price: z.object({ value: z.union([z.string(), z.number()]).optional() }).passthrough().optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough()

export type AskBody = z.infer<typeof askBodySchema>
export type RegenerateBody = z.infer<typeof regenerateBodySchema>
export type QuizCreate = z.infer<typeof quizCreateSchema>
export type QuizUpdate = z.infer<typeof quizUpdateSchema>
export type ExperimentoCreate = z.infer<typeof experimentoCreateSchema>
export type ExperimentoPatch = z.infer<typeof experimentoPatchSchema>
export type ExperimentoDelete = z.infer<typeof experimentoDeleteSchema>
export type NfseEmitir = z.infer<typeof nfseEmitirSchema>
export type NfseCancelar = z.infer<typeof nfseCancelarSchema>

// ---------- Helpers ----------
export interface ParseError {
  ok: false
  error: 'bad_json' | 'invalid'
  issues?: Array<{ path: string; message: string }>
}
export interface ParseOk<T> { ok: true; data: T }
export type ParseResult<T> = ParseOk<T> | ParseError

export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<ParseResult<z.infer<T>>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, error: 'bad_json' }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      issues: parsed.error.issues.map(i => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    }
  }
  return { ok: true, data: parsed.data }
}

// Variante: aceita objeto já parseado (útil quando o handler precisa do raw
// body — caso webhook Hotmart, onde também medimos tamanho antes de validar).
export function parseValue<T extends z.ZodTypeAny>(
  value: unknown,
  schema: T,
): ParseResult<z.infer<T>> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      issues: parsed.error.issues.map(i => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    }
  }
  return { ok: true, data: parsed.data }
}

export function parseQuery<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
): ParseResult<z.infer<T>> {
  const u = new URL(url)
  const obj: Record<string, string> = {}
  u.searchParams.forEach((v, k) => { obj[k] = v })
  const parsed = schema.safeParse(obj)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      issues: parsed.error.issues.map(i => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
      })),
    }
  }
  return { ok: true, data: parsed.data }
}

// ---------- Extração de Comentários (YouTube) ----------
export const extracaoSubmitSchema = z.object({
  urls: z.array(z.string().trim().max(500)).min(1, 'Cole ao menos uma URL').max(50, 'Máximo de 50 linhas por vez'),
})

export const extracaoProcessSchema = z.object({
  id: z.string().uuid('id inválido'),
})

export const extracaoRowsQuerySchema = z.object({
  after_id: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(2000).default(2000),
})

// Resposta padrão pra mismatches — usar em todas as rotas que aplicam parseBody.
export function badRequest(err: ParseError) {
  if (err.error === 'bad_json') {
    return { status: 400, body: { error: 'JSON inválido no body' } }
  }
  return { status: 400, body: { error: 'Body inválido', issues: err.issues } }
}
