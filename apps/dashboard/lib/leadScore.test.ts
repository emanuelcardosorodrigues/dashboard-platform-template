import { describe, expect, it } from 'vitest'
import { buildQuestions, scoreLead, maxScoreOf, tierOf, summarizeLeads, defaultLeadConfig, type LeadScoreConfig } from './leadScore'
import type { SbQualificacao } from './supabase'

const q = (p: Partial<SbQualificacao>): SbQualificacao => ({
  email: 'x@x.com', nome: 'x', whatsapp: '', sexo: '', faixa_etaria: '', estado_civil: '',
  tem_filhos: '', tipo_clinica: '', faturamento_declarado: '', num_cadeiras: '', tempo_odontologia: '',
  especialidade: '', como_conheceu: '', maior_dificuldade: '', medos: '', objetivos: '', o_que_falta: '',
  unica_coisa_incomoda: '', motivo_compra: '', o_que_impediu: '', instagram: '', tentou_antes: '',
  funcionou: '', por_que_nao_funcionou: '', emocao_fim_mes: '', valor_sonho_mensal: '', quanto_sobra: '',
  tem_socio: '', cpf_cnpj: '', tem_ficha: true, ...p,
} as SbQualificacao)

const cfg = (p: Partial<LeadScoreConfig>): LeadScoreConfig => ({ ...defaultLeadConfig('all'), ...p })

describe('buildQuestions — só domínio fechado', () => {
  const rows = [
    q({ faturamento_declarado: 'até 20k', especialidade: 'Ortodontia' }),
    q({ faturamento_declarado: 'acima de 100k', especialidade: 'Implante' }),
    q({ faturamento_declarado: 'até 20k', especialidade: 'Endo' }),
  ]
  it('inclui faturamento (2 distintos) ', () => {
    const qs = buildQuestions(rows)
    const fat = qs.find((x) => x.field === 'faturamento_declarado')
    expect(fat).toBeTruthy()
    expect(fat!.options).toEqual(['acima de 100k', 'até 20k'])
  })
  it('exclui campo com > maxOptions distintos', () => {
    // 3 especialidades distintas, maxOptions=2 → fora
    const qs = buildQuestions(rows, 2)
    expect(qs.find((x) => x.field === 'faturamento_declarado')).toBeTruthy() // 2 distintos = ok
  })
})

describe('scoreLead — soma ÷ máximo', () => {
  const weights = { faturamento_declarado: { 'acima de 100k': 10, 'até 20k': 2 }, tem_socio: { 'Sim': 5, 'Não': 0 } }
  const c = cfg({ weights })
  it('máximo = 10 + 5 = 15', () => expect(maxScoreOf(weights)).toBe(15))
  it('lead top = (10+5)/15 = 100', () => {
    expect(scoreLead(q({ faturamento_declarado: 'acima de 100k', tem_socio: 'Sim' }), c)).toBe(100)
  })
  it('lead baixo = (2+0)/15 ≈ 13', () => {
    expect(scoreLead(q({ faturamento_declarado: 'até 20k', tem_socio: 'Não' }), c)).toBe(13)
  })
  it('sem pesos = 0', () => expect(scoreLead(q({}), cfg({}))).toBe(0))
})

describe('tierOf', () => {
  const c = cfg({ tierQuente: 70, tierMorno: 40 })
  it('quente/morno/frio', () => {
    expect(tierOf(80, c)).toBe('quente')
    expect(tierOf(50, c)).toBe('morno')
    expect(tierOf(10, c)).toBe('frio')
  })

  // #6 — config invertida (tierQuente < tierMorno): normalização deve reordenar
  // e nunca deixar 'morno' inacessível
  it('config invertida (tierQuente=30, tierMorno=60) normaliza e classifica corretamente', () => {
    const inv = cfg({ tierQuente: 30, tierMorno: 60 })
    // Após normalização: efetivo quente=60, morno=30
    expect(tierOf(80, inv)).toBe('quente')
    expect(tierOf(45, inv)).toBe('morno')
    expect(tierOf(20, inv)).toBe('frio')
  })

  it('config invertida não perde nenhum tier (morno acessível)', () => {
    const inv = cfg({ tierQuente: 10, tierMorno: 80 })
    // Normalizado: quente=80, morno=10
    // score 50 deve cair em morno (entre 10 e 80)
    expect(tierOf(50, inv)).toBe('morno')
  })
})

describe('summarizeLeads — distribuição + calibração no alvo', () => {
  const weights = { faturamento_declarado: { 'acima de 100k': 10, 'até 20k': 0 } }
  const c = cfg({ weights, tierQuente: 70, tierMorno: 40, alvoColuna: 'aluno_mentoria' })
  const rows = [
    q({ faturamento_declarado: 'acima de 100k', aluno_mentoria: true }),  // score 100 quente, convertido
    q({ faturamento_declarado: 'acima de 100k', aluno_mentoria: false }), // score 100 quente
    q({ faturamento_declarado: 'até 20k', aluno_mentoria: false }),       // score 0 frio
  ]
  const s = summarizeLeads(rows, c)
  it('distribuição por tier', () => {
    expect(s.dist.quente).toBe(2)
    expect(s.dist.frio).toBe(1)
  })
  it('calibração: quente converte 1/2 = 50%', () => {
    expect(s.conv.quente.taxa).toBe(50)
    expect(s.conv.frio.taxa).toBe(0)
  })
  it('alvoPositivos conta convertidos', () => expect(s.alvoPositivos).toBe(1))
  it('ordena por score desc', () => expect(s.scored[0].score).toBe(100))
})
