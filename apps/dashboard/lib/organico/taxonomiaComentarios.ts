/**
 * Vocabulário FIXO da análise de comentários do Orgânico (regra do dono: a IA
 * escolhe DENTRE estes valores, nunca inventa; a sanitização rejeita qualquer
 * coisa fora daqui). Nicho infoproduto / negócio para dentistas.
 */

export const SENTIMENTOS = ['positivo', 'negativo', 'neutro'] as const
export type Sentimento = typeof SENTIMENTOS[number]

/** 12 buckets de tema. label = exibição; desc = vai no prompt. */
export const TEMAS_COMENTARIO: Record<string, { label: string; desc: string }> = {
  elogio:              { label: 'Elogio',                desc: 'parabéns, gostei, conteúdo bom' },
  duvida_tecnica:      { label: 'Dúvida técnica',        desc: 'pergunta sobre como fazer / procedimento / método' },
  pedido_de_ajuda:     { label: 'Pedido de ajuda',       desc: 'pede orientação pro próprio caso' },
  interesse_compra:    { label: 'Interesse de compra',   desc: 'quer comprar, como adquirir, valor, link' },
  preco_objecao:       { label: 'Objeção de preço',      desc: 'achou caro, reclama de valor' },
  ceticismo:           { label: 'Ceticismo',             desc: 'duvida que funciona, desconfia' },
  historia_pessoal:    { label: 'História pessoal',      desc: 'relata a própria experiência/situação' },
  pedido_de_conteudo:  { label: 'Pedido de conteúdo',    desc: 'pede vídeo/tema futuro' },
  critica:             { label: 'Crítica',               desc: 'discorda, aponta erro, crítica negativa' },
  spam:                { label: 'Spam',                  desc: 'autopromoção, link aleatório, golpe' },
  emoji_apenas:        { label: 'Só emoji',              desc: 'comentário composto só de emojis/reação' },
  off_topic:           { label: 'Fora do tema',          desc: 'sem relação com o conteúdo' },
}
export const TEMA_KEYS = Object.keys(TEMAS_COMENTARIO)

export function isValidSentimento(v: unknown): v is Sentimento {
  return typeof v === 'string' && (SENTIMENTOS as readonly string[]).includes(v)
}
export function isValidTema(v: unknown): v is string {
  return typeof v === 'string' && TEMA_KEYS.includes(v)
}

/** Só-emoji/reação curta: classifica SEM gastar token de IA (determinístico). */
const EMOJI_ONLY_RE = /^(?:[\p{Extended_Pictographic}\p{Emoji_Component}\s❤️✅✨\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F900}-\u{1F9FF}\u{1F680}-\u{1F6FF}]|❤|👏|🔥|👍|🙏|😍|👏🏻|👏🏼|👏🏽|👏🏾|👏🏿)+$/u
export function isEmojiOnly(text: string): boolean {
  const t = (text ?? '').trim()
  return t.length > 0 && EMOJI_ONLY_RE.test(t)
}

/** Vocabulário compacto pro prompt. */
export const COMENTARIOS_PROMPT = [
  'SENTIMENT: um de ' + SENTIMENTOS.join(' | ') + '.',
  'THEMES: até 2 destes (nunca invente outro):',
  TEMA_KEYS.map((k) => `${k}=${TEMAS_COMENTARIO[k].desc}`).join('; ') + '.',
  'is_question: true se o comentário faz uma pergunta.',
].join('\n')

/** Estruturas de roteiro válidas pra classificação de posts (vocabulário fixo). */
export const ESTRUTURAS_POST = [
  'lista', 'tutorial', 'storytelling', 'opiniao', 'reacao',
  'demonstracao', 'pergunta_resposta', 'bastidores',
] as const
export function isValidEstrutura(v: unknown): v is string {
  return typeof v === 'string' && (ESTRUTURAS_POST as readonly string[]).includes(v)
}
