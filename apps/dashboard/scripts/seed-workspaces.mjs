#!/usr/bin/env node
/**
 * Seed inicial dos 5 workspaces de /criativos v2.
 *
 *   demo        — Cliente Exemplo dashboard-demo (avatar + One Belief baked from
 *                mind-vault notes 8kr9wx90evyv e hhfytwtkpfcp).
 *   cli-saude  — Empresa Exemplo placeholder vertical saúde.
 *   cli-moda   — Empresa Exemplo placeholder vertical moda.
 *   cli-emag   — Empresa Exemplo placeholder vertical emagrecimento.
 *   cli-fert   — Empresa Exemplo placeholder vertical fertilidade.
 *
 * Idempotente: ON CONFLICT (slug) atualiza nome/avatar/one_belief/thresholds.
 * Avatar/One Belief dos clientes Equipe ficam null — admin UI preenche depois.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   OWNER_EMAIL=admin@example.com \
 *   node scripts/seed-workspaces.mjs
 *
 * Thresholds recalibrados (mind-vault: 3da495zh8a17, q0iqgvpobn5l, xht0331uskkq,
 * cyhaqcnw9fkd, gxiicc3ld58z):
 */
import { createClient } from '@supabase/supabase-js'

const must = (k) => {
  const v = process.env[k]
  if (!v) {
    console.error(`Missing env: ${k}`)
    process.exit(1)
  }
  return v
}

const supabase = createClient(must('SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const OWNER = (process.env.OWNER_EMAIL || 'admin@example.com').toLowerCase()

// ─── DEMO: thresholds recalibrados ─────────────────────────────────────────────
const LST_THRESHOLDS = {
  hook_rate:        { green: 0.50, yellow: 0.30 },   // <0.30 vermelho
  body_rate:        { green: 0.40, yellow: 0.25 },   // views_p75/views_3s
  retencao_95:      { green: 0.15, yellow: 0.08 },
  roas_liquido:     { green: 1.5,  yellow: 1.0 },
  cpa:              { green: 80,   yellow: 150, direction: 'lower_is_better' },
  cvr_pagina:       { green: 0.03, yellow: 0.015 },
  cvr_checkout:     { green: 0.50, yellow: 0.30 },
  take_rate_ob1:    { green: 0.25, yellow: 0.20 },
  take_rate_ob2:    { green: 0.20, yellow: 0.15 },
  take_rate_ob3:    { green: 0.10, yellow: 0.08 },
  scroll_depth:     { green: 0.60, yellow: 0.40 },
  // Validação pra lateralização: ROAS≥2 E vendas_front≥50 (sócio do Micha)
  validado:         { roas_min: 2.0, vendas_front_min: 50 },
}

// Vocabulário taxonômico: Gemini é forçado a escolher dessas listas.
// Início enxuto — análises manuais em PR 3 expandem.
const LST_VOCAB = {
  angulos: [
    'sangue-no-olho',
    'novo-mecanismo',
    'absolvicao',
    'desnaturalizacao-do-problema',
    'historia-pessoal-fundador',
    'prova-social-pareada',
    'autoridade-tecnica',
  ],
  hooks: [
    'pergunta-direta-dor',
    'estatistica-chocante',
    'confissao-anti-guru',
    'cena-cotidiana-reconhecivel',
    'promessa-numerica',
    'tapa-na-cara',
  ],
  formatos: [
    'depoimento-camera-fixa',
    'reels-cortes-rapidos',
    'fundador-falando-objetiva',
    'tela-com-narração',
    'documentário-vlog',
  ],
  elementos: [
    'closeup-mao-paciente',
    'imagem-clinica-real',
    'planilha-numeros-na-tela',
    'cena-pos-expediente',
    'cartao-de-credito',
    'sorriso-paciente',
  ],
  ctas: [
    'link-na-bio',
    'comenta-quero',
    'clique-saiba-mais',
    'sem-cta-explicito',
  ],
  producao: [
    'celular-amador',
    'profissional-estudio',
    'híbrido',
    'ugc',
  ],
}

const LST_AVATAR = `Dentistas donos de clínica/consultório próprio (>90%), faixa 35–50 anos com forte presença +50, faturamento declarado mais comum R$20–60k/mês, maioria há mais de 10 anos na profissão. Sofisticação nível 4–5: já tentou e falhou com curso de gestão, controle financeiro próprio, cobrar mais (recuou), colocar mais paciente (mais trabalho, mesmo lucro), confiar no contador.

Dores verbatim das 354 fichas:
- "Trabalho muito e sobra pouco."
- "Agenda cheia mas não consigo pagar as contas."
- "35 anos de profissão, agenda cheia, mas não consigo ter lucro."
- "Medo de cobrar. Medo de perder o paciente se aumentar o preço."
- "Trabalho para pagar as contas, não pra mim."
- "Desespero." (uma palavra, de uma dentista com consultório e pacientes)

Dado crítico: 63 de 354 dentistas declararam que sobra ZERO todo mês. 1 em cada 3 não sobra absolutamente nada.

Estado emocional: vergonha silenciosa + resignação aprendida + exaustão + orgulho profissional intacto + ceticismo profundo com gurus.

Implicação para copy: não quer pena. Quer reconhecimento. Não culpar — absolver. Qualquer ângulo de "mais pacientes" é rejeitado, já tentou.`

const LST_ONE_BELIEF = `Tentar trazer mais paciente é o que está te impedindo de ter lucro — porque o dinheiro que você precisa já está dentro da sua clínica, você só nunca teve o mapa para enxergá-lo e coletá-lo.

Fórmula: [Nova Oportunidade] é a chave para [desejo principal] — e isso só é possível através do [Mecanismo Único].

Implicação estratégica: o ângulo de "mais pacientes" é explicitamente contrário à filosofia do produto. Qualquer copy que use captação como promessa central contradiz a One Belief.`

const WORKSPACES = [
  {
    slug: 'demo',
    nome: 'Cliente Exemplo — dashboard-demo',
    one_belief: LST_ONE_BELIEF,
    avatar_brief: LST_AVATAR,
    vocabulario: LST_VOCAB,
    thresholds: LST_THRESHOLDS,
    vault_domains: ['copywriting', 'digital-marketing'],
  },
  {
    slug: 'cli-saude',
    nome: 'Empresa Exemplo — Cliente Saúde (placeholder)',
    one_belief: null,
    avatar_brief: null,
    vocabulario: {},
    thresholds: LST_THRESHOLDS, // herda DEMO por default até admin customizar
    vault_domains: ['digital-marketing'],
  },
  {
    slug: 'cli-moda',
    nome: 'Empresa Exemplo — Cliente Moda (placeholder)',
    one_belief: null,
    avatar_brief: null,
    vocabulario: {},
    thresholds: LST_THRESHOLDS,
    vault_domains: ['digital-marketing'],
  },
  {
    slug: 'cli-emag',
    nome: 'Empresa Exemplo — Cliente Emagrecimento (placeholder)',
    one_belief: null,
    avatar_brief: null,
    vocabulario: {},
    thresholds: LST_THRESHOLDS,
    vault_domains: ['digital-marketing'],
  },
  {
    slug: 'cli-fert',
    nome: 'Empresa Exemplo — Cliente Fertilidade (placeholder)',
    one_belief: null,
    avatar_brief: null,
    vocabulario: {},
    thresholds: LST_THRESHOLDS,
    vault_domains: ['digital-marketing'],
  },
]

async function upsertWorkspace(ws) {
  const { data: existing } = await supabase
    .from('workspaces')
    .select('id')
    .eq('slug', ws.slug)
    .maybeSingle()

  const row = {
    slug: ws.slug,
    nome: ws.nome,
    one_belief: ws.one_belief,
    avatar_brief: ws.avatar_brief,
    vocabulario: ws.vocabulario,
    thresholds: ws.thresholds,
    vault_domains: ws.vault_domains,
    updated_at: new Date().toISOString(),
  }

  if (existing?.id) {
    const { error } = await supabase.from('workspaces').update(row).eq('id', existing.id)
    if (error) throw new Error(`update workspace ${ws.slug}: ${error.message}`)
    console.log(`updated workspace ${ws.slug} (${existing.id})`)
    return existing.id
  }

  const { data, error } = await supabase
    .from('workspaces')
    .insert(row)
    .select('id')
    .single()
  if (error) throw new Error(`insert workspace ${ws.slug}: ${error.message}`)
  console.log(`created workspace ${ws.slug} (${data.id})`)
  return data.id
}

async function addOwner(workspaceId, email) {
  const { error } = await supabase
    .from('workspace_members')
    .upsert(
      { workspace_id: workspaceId, user_email: email, role: 'owner' },
      { onConflict: 'workspace_id,user_email' }
    )
  if (error) throw new Error(`add owner ${email} -> ${workspaceId}: ${error.message}`)
}

for (const ws of WORKSPACES) {
  const id = await upsertWorkspace(ws)
  await addOwner(id, OWNER)
}

console.log(`done. owner=${OWNER}`)
