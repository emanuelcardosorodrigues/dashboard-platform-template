import { SchemaType } from '@google/generative-ai'
import { TAXONOMIA_PROMPT } from '../taxonomia-demo'

export const CRIATIVO_ANALISE_PROMPT_VERSION = 'criativo-analise-v3-demo-texto'

export interface WorkspaceContext {
  nome: string
  one_belief: string | null
  avatar_brief: string | null
  vocabulario: Record<string, unknown>
}

export interface CriativoAnalisePromptInput {
  workspace: WorkspaceContext
  copy: string | null
  /** Transcrição Whisper (VPS). Quando presente, a análise é sobre TEXTO+frames (não re-baixa vídeo). */
  transcricao?: string | null
  /** Nº de frames anexados (extraídos pela VPS) para contexto visual. */
  framesCount?: number
  /** Legado: vídeo inline anexado (quando não há transcrição Whisper). */
  hasVideo?: boolean
  /** Anúncio de IMAGEM estática (sem vídeo/áudio) — classifica pela imagem + copy. */
  isImage?: boolean
}

/**
 * Schema JSON do retorno — Gemini structured output. Casado com as colunas de
 * `criativo_analise`. Campos jsonb (estrutura_roteiro, padroes_detectados)
 * carregam sub-campos sem precisar de DDL.
 */
export const criativoAnaliseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    transcricao: {
      type: SchemaType.STRING,
      description:
        'Transcrição literal da fala. Se uma transcrição já vier no prompt (Whisper), REPITA-A fielmente aqui, sem reescrever. Vazio só se realmente não houver fala.',
    },
    resumo: { type: SchemaType.STRING, description: '2-3 frases descrevendo o que acontece no criativo, ponta a ponta. Descreve, não interpreta.' },
    hook_descricao: { type: SchemaType.STRING, description: 'O gancho dos primeiros 3s — frase visual + frase falada + emoção. Concreto, não "é envolvente".' },
    hook_tipo: {
      type: SchemaType.ARRAY,
      description:
        'Mecanismo(s) do gancho — taxonomia DEMO (9 mecanismos). PAR=Paradoxo, ESP=Espelho de dor, CUR=Curiosidade, POL=Polêmica, PER=Pergunta direta, AUT=Autoridade, URG=Urgência, DEMO=Demonstração, ID=Identificação. Use só estes códigos.',
      items: { type: SchemaType.STRING, enum: ['PAR', 'ESP', 'CUR', 'POL', 'PER', 'AUT', 'URG', 'DEMO', 'ID'] },
    },
    angulo_copy: {
      type: SchemaType.ARRAY,
      description: 'Ângulo argumentativo dominante do copy/fala.',
      items: {
        type: SchemaType.STRING,
        enum: ['dor', 'ganho', 'status', 'identidade', 'fomo', 'prova_social', 'simplicidade', 'metodo', 'transformacao'],
      },
    },
    formato_visual: {
      type: SchemaType.ARRAY,
      description:
        'Formato DEMO (responda com a SIGLA). TH-CAM=talking head câmera, TH-CLI=talking head clínica, TH-DESK=talking head mesa, POV, CPAP=cálculo/demo ao vivo, FAFZ, Cinema, Rotina, Esquete, "Conversa no Carro". Use só estas siglas.',
      items: {
        type: SchemaType.STRING,
        enum: ['POV', 'Esquete', 'FAFZ', 'Conversa no Carro', 'CPAP', 'Cinema', 'Rotina', 'TH-CAM', 'TH-CLI', 'TH-DESK'],
      },
    },
    elementos_visuais: {
      type: SchemaType.ARRAY,
      description: 'Elementos visuais notáveis (legendas duras, zoom, cortes rápidos, texto na tela, etc.). Use os frames anexados.',
      items: { type: SchemaType.STRING },
    },
    cta: {
      type: SchemaType.ARRAY,
      description: 'CTAs identificados na fala (transcrição) e na copy do post.',
      items: { type: SchemaType.STRING },
    },
    producao: {
      type: SchemaType.ARRAY,
      description: 'Qualidades de produção (amador/profissional, iluminação, áudio, edição, ritmo).',
      items: { type: SchemaType.STRING },
    },
    nivel_consciencia: {
      type: SchemaType.STRING,
      description: 'Nível de consciência do avatar (Eugene Schwartz) que este criativo ataca.',
      enum: ['Inconsciente', 'Consciente do problema', 'Consciente da solução', 'Consciente do produto', 'O mais consciente'],
    },
    momento_funil: {
      type: SchemaType.STRING,
      description: 'Momento de funil que o criativo serve.',
      enum: ['Topo', 'Meio', 'Fundo', 'Remarketing'],
    },
    promessa_principal: {
      type: SchemaType.STRING,
      description: 'A promessa central, em uma frase, na voz do criativo (o que o avatar leva se agir).',
    },
    one_belief_score: {
      type: SchemaType.NUMBER,
      description: 'De 0 a 1: quanto este criativo reforça o One Belief do workspace. 1 = totalmente aderente, 0 = contradiz/ignora.',
    },
    one_belief_desvio: { type: SchemaType.STRING, description: 'Explicação do score: o que falta ou onde desvia do One Belief. Vazio se score=1.' },
    estrutura_roteiro: {
      type: SchemaType.OBJECT,
      description: 'Estrutura argumentativa do roteiro.',
      properties: {
        narrativa: {
          type: SchemaType.STRING,
          description:
            'A narrativa argumentativa em 1-2 frases (PRSA: Problema→Reviravolta→Solução→Ação) — como o argumento se constrói do gancho ao CTA.',
        },
        gancho: { type: SchemaType.STRING, description: 'Conteúdo dos primeiros 3-5s.' },
        desenvolvimento: { type: SchemaType.STRING, description: 'Corpo (5s até antes do CTA).' },
        cta_timing: { type: SchemaType.STRING, description: 'Quando o CTA aparece (ex: "ao final, ~aos 18s").' },
        confianca: { type: SchemaType.NUMBER, description: 'De 0 a 1: sua confiança na leitura da estrutura (menor se sem vídeo/áudio).' },
      },
      required: ['narrativa'],
    },
    padroes_detectados: {
      type: SchemaType.OBJECT,
      description: 'Padrões livres + classificadores complementares.',
      properties: {
        gancho_codigo: {
          type: SchemaType.ARRAY,
          description: 'Código(s) de gancho do banco DEMO g01–g46 (faixa fixa). Escolha o mais próximo; NUNCA invente fora da faixa.',
          items: { type: SchemaType.STRING },
        },
        tom: { type: SchemaType.STRING, description: 'Tom dominante (ex: urgente, didático, confessional, provocador, empático).' },
        objecoes_respondidas: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        gatilhos_mentais: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        observacoes: { type: SchemaType.STRING },
      },
    },
  },
  required: [
    'resumo',
    'hook_descricao',
    'hook_tipo',
    'angulo_copy',
    'formato_visual',
    'cta',
    'nivel_consciencia',
    'momento_funil',
    'promessa_principal',
    'one_belief_score',
    'estrutura_roteiro',
  ],
} as const

export function buildCriativoAnalisePrompt(input: CriativoAnalisePromptInput): string {
  const { workspace, copy, transcricao, framesCount = 0, hasVideo = false, isImage = false } = input
  const vocab = JSON.stringify(workspace.vocabulario ?? {}, null, 2)
  const temTranscricao = !!(transcricao && transcricao.trim())

  // Descreve o material conforme o modo (texto+frames da VPS, vídeo legado, ou imagem estática).
  let material: string
  if (temTranscricao) {
    material = `Você recebe a TRANSCRIÇÃO completa da fala (Whisper) + ${framesCount} frame(s) do vídeo (hook/corpo/CTA) anexados como imagens. Use os frames para o visual (formato, elementos, produção) e a transcrição para a fala/argumento. NÃO há vídeo bruto — não diga que faltou assistir.

### Transcrição (Whisper)
"""${transcricao!.trim()}"""`
  } else if (isImage) {
    material = `Este é um anúncio de IMAGEM ESTÁTICA — a imagem do criativo está anexada. Analise a imagem (texto na arte, visual, oferta) + a copy do post. NÃO há vídeo nem áudio: deixe \`transcricao\` = "" e \`estrutura_roteiro.confianca\` baixa. O "hook" aqui é o que prende o olhar na imagem (headline/visual). \`formato_visual\` reflete o formato estático mais próximo da lista.`
  } else if (hasVideo) {
    material = 'O vídeo do criativo está anexado. Assista por completo antes de responder, e transcreva a fala.'
  } else {
    material = 'ATENÇÃO: sem vídeo e sem transcrição. Análise limitada ao thumbnail (se anexado) + copy — baixe a confiança de estrutura.'
  }

  return `Você é analista sênior de criativos pagos especializado em VSL/UGC pra infoprodutos, no método DEMO.

# Cliente: ${workspace.nome}

## One Belief (a única coisa que TODO criativo desse cliente precisa reforçar)
${workspace.one_belief ?? '(não definido — score=null e desvio="One Belief não cadastrado no workspace")'}

## Avatar
${workspace.avatar_brief ?? '(não definido)'}

## Vocabulário taxonômico do cliente (termos que ressoam com o avatar)
\`\`\`json
${vocab}
\`\`\`

## Taxonomia DEMO (use SOMENTE estes códigos — nunca invente)
${TAXONOMIA_PROMPT}

## Material a analisar
${material}

### Copy do post (texto do anúncio)
${copy ? `"""${copy}"""` : '(sem copy textual)'}

## Sua tarefa
Retornar JSON estruturado seguindo o schema. Regras:

1. **Transcrição**: se já veio acima (Whisper), repita-a fielmente no campo \`transcricao\`. Não reescreva nem resuma.
2. **Resumo**: 2-3 frases, descritivo.
3. **Hook**: foco nos primeiros 3-5s — o que prende. Concreto.
4. **Taxonomia (obrigatório)**: \`hook_tipo\` = mecanismo(s) do enum; \`padroes_detectados.gancho_codigo\` = código(s) g01–g46 do banco DEMO (o mais próximo, nunca fora da faixa); \`formato_visual\` = SIGLA(s) do enum. Sem match exato, escolha o mais próximo da lista.
5. **nivel_consciencia / momento_funil / promessa_principal**: sempre preencher, escolhendo o que o criativo de fato ataca/serve.
6. **estrutura_roteiro.narrativa**: a lógica argumentativa em 1-2 frases (PRSA). Preencha \`confianca\` menor quando faltar vídeo/áudio.
7. **one_belief_score**: 1.0 defende o One Belief o tempo todo; 0.7 implícito; 0.4 tangencial; 0.0 ignora/contradiz. Preencha \`one_belief_desvio\` quando score < 1.0.
8. **Não invente**: o que não está no material, não inclua. Arrays vazios são válidos.
9. **Use o vocabulário do cliente** na hook_descricao e nas observações.

Responda APENAS o JSON. Sem markdown, sem prefácio.`
}
