import { describe, it, expect } from 'vitest'
import { resolverFunil, classificarProduto, labelFrontDoFunil, temToken, DEFAULT_FUNIS } from './funisConfig'
import { parseSck as parseSckSync } from './hotmartSync'

// Os "esperados" abaixo são o comportamento ATUAL (resolveFunil/produtoToTipo/produtoToFunil
// /produtoBumpDefault em lib/supabase.ts) derivado à mão. Se a config-padrão divergir, quebra.

describe('resolverFunil (config-padrão = régua atual)', () => {
  it('token no criativo/sck/campanha vence tudo', () => {
    expect(resolverFunil({ criativo: 'demo-col-vid01' })).toBe('col')
    expect(resolverFunil({ sck: 'plo-pv02_ckck01' })).toBe('plo')
    expect(resolverFunil({ campaign: 'DPL - Teste 03' })).toBe('dpl')
    expect(resolverFunil({ criativo: 'demo-lps-aula' })).toBe('lps')
  })

  it('token dpl no criativo manda o Dentista pro DPL (front), não pro COL', () => {
    expect(resolverFunil({ criativo: 'demo-dpl-x', produto: 'Protocolo Dentista Parceiro' })).toBe('dpl')
  })

  it('produto front/upsell fixo (sem token) roteia por filiação', () => {
    expect(resolverFunil({ produto: 'Produto Demonstrativo' })).toBe('col')
    expect(resolverFunil({ produto: 'Protocolo Lucro Oculto' })).toBe('plo')
    expect(resolverFunil({ produto: 'Imersão Lucro Clínico' })).toBe('lps')
    expect(resolverFunil({ produto: 'Implementação Lucro Oculto' })).toBe('plo')
    expect(resolverFunil({ produto: 'Implementação Express Lucro Oculto' })).toBe('plo')
  })

  it('order bumps (sem token/front) caem no default COL', () => {
    expect(resolverFunil({ produto: 'Script ANTI-Desconto' })).toBe('col')
    expect(resolverFunil({ produto: 'Lucro Tributário Express' })).toBe('col')
    expect(resolverFunil({ produto: 'Manual do Lucro Oculto' })).toBe('col')
    // Dentista SEM token dpl: ambíguo (front no DPL, OB no COL) → COL, não DPL.
    expect(resolverFunil({ produto: 'Protocolo Dentista Parceiro' })).toBe('col')
  })

  it('herança por email resolve OB órfão antes do default; mas não vence produto fixo', () => {
    // OB órfão (Script) com email de comprador LPS → herda LPS (prioridade 5 > default 6).
    expect(resolverFunil({ produto: 'Script ANTI-Desconto', emailFunil: 'lps' })).toBe('lps')
    // Front fixo ignora a herança de email (prioridade 4 > 5).
    expect(resolverFunil({ produto: 'Produto Demonstrativo', emailFunil: 'plo' })).toBe('col')
  })
})

describe('classificarProduto (papel no funil resolvido)', () => {
  it('fronts e produtos não-ambíguos', () => {
    expect(classificarProduto('Produto Demonstrativo', 'col')).toBe('frontEnd')
    expect(classificarProduto('Protocolo Lucro Oculto', 'plo')).toBe('frontEnd')
    expect(classificarProduto('Imersão Lucro Clínico', 'lps')).toBe('frontEnd')
    expect(classificarProduto('Implementação Lucro Oculto', 'plo')).toBe('upsell')
    expect(classificarProduto('Implementação Express Lucro Oculto', 'plo')).toBe('downsell')
  })

  it('order bumps mantêm ob1..ob4', () => {
    expect(classificarProduto('Script ANTI-Desconto', 'col')).toBe('ob1')
    expect(classificarProduto('Lucro Tributário Express', 'col')).toBe('ob2')
    expect(classificarProduto('Protocolo Dentista Parceiro', 'col')).toBe('ob3')
    expect(classificarProduto('Manual do Lucro Oculto', 'col')).toBe('ob4')
  })

  it('Dentista é front no DPL e ob3 no COL/sem funil (igual ao isDpl atual)', () => {
    expect(classificarProduto('Protocolo Dentista Parceiro', 'dpl')).toBe('frontEnd')
    expect(classificarProduto('Protocolo Dentista Parceiro', 'col')).toBe('ob3')
    expect(classificarProduto('Protocolo Dentista Parceiro', null)).toBe('ob3') // default = 1º por ordem (COL)
  })

  it('produto desconhecido cai em frontEnd (igual ao fallback atual)', () => {
    expect(classificarProduto('KIT Lucro Blindado!', null)).toBe('frontEnd')
    expect(classificarProduto('Produto Aleatório XYZ', 'col')).toBe('frontEnd')
  })
})

describe('utilitários', () => {
  it('temToken respeita fronteira de palavra (não casa "protocolo" com "col")', () => {
    expect(temToken('protocolo lucro', 'col')).toBe(false)
    expect(temToken('demo-col-vid', 'col')).toBe(true)
    expect(temToken('COL - Teste', 'col')).toBe(true)
  })

  it('labelFrontDoFunil devolve o match do produto front', () => {
    expect(labelFrontDoFunil('col')).toBe('produto demonstrativo')
    expect(labelFrontDoFunil('plo')).toBe('protocolo lucro oculto')
  })

  it('config-padrão tem 4 funis ativos', () => {
    expect(DEFAULT_FUNIS.filter((f) => f.ativo).map((f) => f.slug).sort()).toEqual(['col', 'dpl', 'lps', 'plo'])
  })
})

describe('primeira sigla vence (regra do Equipe, 25/07/2026)', () => {
  it('quando duas siglas aparecem, vale a que vem PRIMEIRO — não a ordem do funil', () => {
    // O caso real que motivou a regra: página de cross-sell que vende a Calculadora
    // (produto do COL) pros alunos do LPS. O funil é LPS; o `col` no meio é o nome do
    // produto ofertado. A régua antiga varria os funis por `ordem` e devolvia o primeiro
    // que casasse em qualquer posição — COL (ordem 1) ganhava de LPS (ordem 3) mesmo
    // aparecendo 31 caracteres depois, e 39 vendas de R$1 do LPS viravam front do COL.
    expect(resolverFunil({ sck: 'lps-pv06-alunos-calculadora-col-1real' })).toBe('lps')
    // Espelho: se a ordem no texto inverter, o funil inverte junto.
    expect(resolverFunil({ sck: 'col-pv02-alunos-lps' })).toBe('col')
  })

  it('sigla no MEIO continua valendo quando é a primeira (convenção do criativo)', () => {
    // Criativo é `{expert}-{funil}-{tipo}-{n}` — a sigla nunca está no início, e tem que
    // contar mesmo assim. Regra de prefixo quebraria todo o ranking por criativo.
    expect(resolverFunil({ criativo: 'demo-col-vid-04' })).toBe('col')
    expect(resolverFunil({ criativo: 'demo-lps-vid-01' })).toBe('lps')
    expect(resolverFunil({ criativo: 'demo-col-vid-12-pov-achei-que-ganhava-bem-vdentista' })).toBe('col')
  })

  it('prefixo de caminho do Worker (p/, q/) não atrapalha', () => {
    // O Worker de páginas e o de quiz injetam `p/` e `q/` no sck (132 linhas backfilladas).
    expect(resolverFunil({ sck: 'p/col-pvia03' })).toBe('col')
    expect(resolverFunil({ sck: 'q/col-q02_pvcol-q02_ckck-ob1-padrao' })).toBe('col')
  })

  it('prioridade entre CAMPOS não muda: criativo vence sck, que vence campanha', () => {
    expect(resolverFunil({ criativo: 'demo-col-vid-04', sck: 'lps-pv01' })).toBe('col')
    expect(resolverFunil({ sck: 'lps-pv01', campaign: 'COL - Escala' })).toBe('lps')
  })

  it('texto sem sigla nenhuma não resolve por token', () => {
    expect(resolverFunil({ sck: 'HOTMART_CLUB_PRODUCT_PAGE_C' })).toBeNull()
    expect(resolverFunil({ sck: 'wapi-web01' })).toBeNull()
  })

  it('protoCOLo não casa col (fronteira de palavra preservada)', () => {
    expect(resolverFunil({ criativo: 'protocolo-dentista' })).toBeNull()
  })
})

// ── Regra por ID do produto (migration 0067) ─────────────────────────────────
// O que motivou: nome de produto é editável na Hotmart. Em 19/07/2026 "Manual do
// Lucro Oculto no WhatsApp" virou "Manual de Encantamento no WhatsApp" e a regra
// `match:'manual'` só sobreviveu porque a palavra "manual" ficou por acaso.

describe('classificarProduto por ID', () => {
  // COL com os IDs reais do painel: front Calculadora, OB1 Script, OB4 Manual.
  const FUNIS_POR_ID = [{
    slug: 'col', nome: 'COL', ordem: 1, ativo: true,
    produtos: [
      { match: 'PRODUTO_ID_DEMO', por: 'id' as const, papel: 'front' as const },
      { match: 'PRODUTO_ID_OB1_DEMO, PRODUTO_ID_OB1_ADICIONAL_DEMO', por: 'id' as const, papel: 'ob' as const, ordemOb: 1 },
      { match: 'PRODUTO_ID_OB4_DEMO', por: 'id' as const, papel: 'ob' as const, ordemOb: 4 },
    ],
    campanhas: { habilitado: true, tokens: ['col'], campos: ['ad_name' as const] },
  }]

  it('casa pelo ID exato', () => {
    expect(classificarProduto('Produto Demonstrativo', 'col', FUNIS_POR_ID, 'PRODUTO_ID_DEMO')).toBe('frontEnd')
    expect(classificarProduto('Script ANTI-Desconto', 'col', FUNIS_POR_ID, 'PRODUTO_ID_OB1_DEMO')).toBe('ob1')
  })

  it('aceita vários IDs no mesmo papel (separados por vírgula)', () => {
    // "Script Anti Desconto + Lucro Tributário Express" é um SKU novo que ocupa o
    // mesmo papel do Script avulso.
    expect(classificarProduto('Script Anti Desconto + Lucro Tributário Express', 'col', FUNIS_POR_ID, 'PRODUTO_ID_OB1_ADICIONAL_DEMO')).toBe('ob1')
  })

  it('CONTROLE NEGATIVO: ID por trecho NÃO casa — só igualdade', () => {
    // Os IDs da Hotmart compartilham prefixo (8204315 / 8204066 / 8217416). Se o
    // match fosse `includes`, um prefixo colaria produtos diferentes no mesmo papel.
    // O papel de teste é ob1 (≠ frontEnd) justamente pra distinguir "casou" de
    // "caiu no fallback" — com papel front os dois resultados seriam iguais.
    const regra = (match: string) => [{ ...FUNIS_POR_ID[0], produtos: [{ match, por: 'id' as const, papel: 'ob' as const, ordemOb: 1 }] }]
    // positivo: ID inteiro casa e vira ob1
    expect(classificarProduto('Produto Demonstrativo', 'col', regra('PRODUTO_ID_DEMO'), 'PRODUTO_ID_DEMO')).toBe('ob1')
    // negativo: prefixo do mesmo ID não casa → cai no fallback frontEnd
    expect(classificarProduto('Produto Demonstrativo', 'col', regra('689'), 'PRODUTO_ID_DEMO')).toBe('frontEnd')
    // negativo: sufixo idem
    expect(classificarProduto('Produto Demonstrativo', 'col', regra('9431'), 'PRODUTO_ID_DEMO')).toBe('frontEnd')
  })

  it('CONTROLE NEGATIVO: sem produto_id na linha, a regra por ID não casa', () => {
    // Histórico anterior ao backfill: silêncio correto (fallback), nunca um
    // fallback escondido pro nome — que reintroduziria o bug do rename.
    expect(classificarProduto('Script ANTI-Desconto', 'col', FUNIS_POR_ID, '')).toBe('frontEnd')
  })

  it('rename do produto NÃO muda a classificação quando a regra é por ID', () => {
    const antes = classificarProduto('Manual do Lucro Oculto no WhatsApp', 'col', FUNIS_POR_ID, 'PRODUTO_ID_OB4_DEMO')
    const depois = classificarProduto('Manual de Encantamento no WhatsApp', 'col', FUNIS_POR_ID, 'PRODUTO_ID_OB4_DEMO')
    expect(antes).toBe('ob4')
    expect(depois).toBe('ob4')
  })

  it('e o mesmo rename QUEBRA a regra por nome — o bug que motivou a mudança', () => {
    const porNome = [{ ...FUNIS_POR_ID[0], produtos: [
      { match: 'manual lucro oculto', por: 'nome' as const, papel: 'ob' as const, ordemOb: 4 },
    ] }]
    expect(classificarProduto('Manual do Lucro Oculto no WhatsApp', 'col', porNome, 'PRODUTO_ID_OB4_DEMO')).toBe('ob4')
    expect(classificarProduto('Manual de Encantamento no WhatsApp', 'col', porNome, 'PRODUTO_ID_OB4_DEMO')).toBe('frontEnd') // desclassificou
  })

  it('resolverFunil roteia pelo ID quando não há token de campanha', () => {
    expect(resolverFunil({ produto: 'Nome Qualquer', produtoId: 'PRODUTO_ID_DEMO' }, FUNIS_POR_ID)).toBe('col')
    expect(resolverFunil({ produto: 'Nome Qualquer', produtoId: '9999999' }, FUNIS_POR_ID)).toBeNull()
  })
})

// ── Tokens em utm_campaign / content / term (migration 0068) ─────────────────
// Venda fechada fora do anúncio (WhatsApp, por exemplo) não tem ad_name nem
// campanha do Meta — mas pode carregar a utm_campaign do funil de origem.

describe('resolverFunil por utm_campaign', () => {
  const comUtm = DEFAULT_FUNIS.map((f) => ({
    ...f,
    campanhas: { ...f.campanhas, campos: [...f.campanhas.campos, 'utm_campaign' as const, 'utm_term' as const] },
  }))

  it('token na utm_campaign resolve o funil quando não há criativo nem sck', () => {
    expect(resolverFunil({ utmCampaign: 'lps-imersao-agosto' }, comUtm)).toBe('lps')
    expect(resolverFunil({ utmCampaign: 'col-escala-02' }, comUtm)).toBe('col')
  })

  it('token na utm_term também resolve quando o campo está habilitado', () => {
    expect(resolverFunil({ utmTerm: 'plo' }, comUtm)).toBe('plo')
  })

  it('CONTROLE NEGATIVO: campo não habilitado no funil é ignorado', () => {
    // DEFAULT_FUNIS não lista utm_campaign em `campos` — o mesmo valor não resolve.
    expect(resolverFunil({ utmCampaign: 'lps-imersao-agosto' }, DEFAULT_FUNIS)).toBeNull()
  })

  it('CONTROLE NEGATIVO: utm_campaign sem token de funil nenhum não resolve', () => {
    expect(resolverFunil({ utmCampaign: 'grupo-aguia' }, comUtm)).toBeNull()
    expect(resolverFunil({ utmCampaign: 'whatsapp-privado' }, comUtm)).toBeNull()
  })

  it('criativo continua vencendo utm_campaign (ordem de prioridade preservada)', () => {
    expect(resolverFunil({ criativo: 'demo-col-vid-04', utmCampaign: 'lps-imersao' }, comUtm)).toBe('col')
  })
})

describe('parseSck — pacote completo', () => {
  it('lê campaign, content e term do último e do primeiro impacto', async () => {
    const { parseSck } = await import('./hotmartSync')
    const sck = 'col-pv02|Instagram_Feed|pago-metaads|col-escala|criativo-07|dentista-lucro|1200|col-pv01|google|organico|col-seo|post-3|dentista|1300'
    const p = parseSck(sck)
    expect(p.utmCampaign).toBe('col-escala')
    expect(p.utmContent).toBe('criativo-07')
    expect(p.utmTerm).toBe('dentista-lucro')
    expect(p.utmCampaignPrim).toBe('col-seo')
    expect(p.utmTermPrim).toBe('dentista')
    expect(p.adId).toBe('1200')
    expect(p.raw).toBe(sck)
  })

  it('posição sem nome vira posN no pacote — parâmetro novo não se perde', () => {
    // 15 posições: a 14 não existe no mapeamento atual.
    const p = parseSckSync('a|b|c|d|e|f|g|h|i|j|k|l|m|n|valor-novo')
    expect(p.todas['pos14']).toBe('valor-novo')
  })

  it('valores vazios da Hotmart (0/null) não entram no pacote', () => {
    const p = parseSckSync('col-pv02|0|null||campanha')
    expect(p.todas['utm_source']).toBeUndefined()
    expect(p.todas['utm_medium']).toBeUndefined()
    expect(p.todas['utm_content']).toBe('campanha')
  })
})
