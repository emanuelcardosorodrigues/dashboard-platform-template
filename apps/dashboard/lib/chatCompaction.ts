/**
 * A-F5: COMPACTION do histórico de chat.
 *
 * Antes: chats longos eram cortados no braço (`slice(-40)` / `slice(-MAX_HISTORY_TURNS)`)
 * e o contexto antigo SUMIA. Aqui trocamos o corte por COMPACTION: os turns mais
 * antigos são RESUMIDOS num único turn sintético (via Gemini/free — nunca Claude,
 * pra não gastar assinatura), e os últimos K turns ficam verbatim.
 *
 * Contrato:
 *  - abaixo do threshold → comportamento IDÊNTICO ao antigo (`slice(-fallbackSlice)`);
 *  - acima do threshold → [resumo sintético, ...últimos K turns];
 *  - BEST-EFFORT: se o resumo falhar/estourar timeout, cai pro `slice(-fallbackSlice)`
 *    (NUNCA quebra o chat).
 *
 * Alternância de papéis: o turn sintético é 'user' (o SDK do Gemini exige que o
 * primeiro item do history seja 'user'; ver validateChatHistory) e a janela mantida
 * é alinhada pra COMEÇAR num turn 'model' — assim [user(resumo), model, user, …]
 * alterna limpo tanto pro Gemini quanto pro bridge do Claude (que é estrito).
 */
import { generateText, type ChatMessage } from '@/lib/gemini'

export interface CompactHistoryOpts {
  /** Quantos turns finais manter verbatim. Default 16. */
  keepLast?: number
  /** Só compacta quando total de turns passa disso. Default 24. */
  threshold?: number
  /** Fallback (e comportamento abaixo do threshold) = slice(-fallbackSlice). Default 40. */
  fallbackSlice?: number
  /** Teto de tempo pro resumo; ao estourar, faz fallback. Default 20s. */
  timeoutMs?: number
  /** Gerador de texto (injetável p/ teste). Default = generateText (Gemini/free, nunca Claude). */
  summarize?: (prompt: string) => Promise<string>
}

const SUMMARY_PREFIX = '## Resumo da conversa até aqui\n'

function roleLabel(role: ChatMessage['role']): string {
  return role === 'user' ? 'Usuário' : 'Assistente'
}

function buildSummaryPrompt(older: ChatMessage[]): string {
  const transcript = older
    .map((t) => `${roleLabel(t.role)}: ${t.content}`)
    .join('\n\n')
  return [
    'Você é um compactador de contexto de um chat entre um gestor de tráfego/criativos e um assistente de IA.',
    'Resuma a conversa ABAIXO num bloco COMPACTO em português, preservando o que o assistente precisa pra continuar coerente:',
    '- fatos e números citados (métricas, ad_ids, nomes de criativos, campanhas);',
    '- decisões tomadas e recomendações já dadas;',
    '- ações executadas (ex.: tags aplicadas) e preferências do usuário;',
    '- perguntas/threads em aberto que ainda não foram resolvidas.',
    'Seja denso e factual. Sem preâmbulo, sem repetir estas instruções. Não invente nada que não esteja na conversa.',
    '',
    '--- CONVERSA ---',
    transcript,
    '--- FIM ---',
  ].join('\n')
}

/**
 * Compacta o histórico: mantém os últimos K turns verbatim e resume o resto num
 * único turn sintético inserido ANTES deles. Best-effort — nunca lança.
 */
export async function compactHistory(
  turns: ChatMessage[],
  opts: CompactHistoryOpts = {}
): Promise<ChatMessage[]> {
  const K = opts.keepLast ?? 16
  const threshold = opts.threshold ?? 24
  const fallbackSlice = opts.fallbackSlice ?? 40
  const timeoutMs = opts.timeoutMs ?? 20_000
  const summarize = opts.summarize ?? generateText

  // Abaixo do threshold: comportamento IDÊNTICO ao antigo.
  if (turns.length <= threshold) return turns.slice(-fallbackSlice)

  // Janela mantida: começa preferencialmente num turn 'model' pra alternar limpo
  // depois do resumo sintético ('user'). Conversas persistidas alternam
  // user/model, então recuar 1 quando cai num 'user' garante início em 'model'.
  let cut = turns.length - K
  if (cut > 0 && turns[cut]?.role === 'user') cut -= 1
  const recent = turns.slice(cut)
  const older = turns.slice(0, cut)

  // Nada pra resumir (não deveria acontecer acima do threshold) → sem compaction.
  if (older.length === 0 || recent.length === 0) return turns.slice(-fallbackSlice)

  try {
    const prompt = buildSummaryPrompt(older)
    const summary = await Promise.race([
      summarize(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('compaction timeout')), timeoutMs)
      ),
    ])
    if (!summary || !summary.trim()) throw new Error('resumo vazio')

    const syntheticTurn: ChatMessage = {
      role: 'user',
      content: SUMMARY_PREFIX + summary.trim(),
    }
    return [syntheticTurn, ...recent]
  } catch {
    // BEST-EFFORT: qualquer falha no resumo → corte antigo, chat nunca quebra.
    return turns.slice(-fallbackSlice)
  }
}
