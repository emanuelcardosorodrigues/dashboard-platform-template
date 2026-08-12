/**
 * Linha do tempo (dia a dia) de UMA variante — a aba "Desempenho" do pop-up de histórico.
 *
 * Vem de `impressions` / `route_clicks` / `checkout_hits` / `transacoes`, que TÊM histórico —
 * ao contrário das alterações de variante, que nunca foram gravadas (por isso a outra aba
 * começa vazia). Aqui o passado inteiro está disponível, retroativo.
 *
 * Função pura: a route busca as linhas cruas e passa pra cá. Toda razão respeita a mesma
 * regra do resto do sistema — numerador e denominador na MESMA identidade (uid) e no MESMO
 * dia; nunca cruza cid do GA com uid do Worker.
 */

export interface DiaVariante {
  dia: string              // YYYY-MM-DD (America/Sao_Paulo)
  visualizacoes: number    // linhas de impressão (page loads contados pelo beacon)
  visitantes: number       // uids distintos que viram
  roteados: number         // uids distintos que o 302 roteou
  chegaram: number         // dos roteados, quantos o beacon confirmou na página
  connectRate: number | null // chegaram ÷ roteados (null sem clique roteado — nunca 0% falso)
  cliquesCheckout: number  // uids distintos (dos que viram) que clicaram pro checkout
  vendas: number
  receita: number
}

export interface LinhasCruas {
  impressoes: { uid: string; dia: string }[]
  routeClicks: { uid: string; dia: string }[]
  checkoutHits: { uid: string | null; dia: string }[]  // já filtrados pelos slugs da variante
  vendas: { dia: string; valor: number }[]             // já casadas com a variante pelo sck
}

function ensure(map: Map<string, DiaVariante>, dia: string): DiaVariante {
  let d = map.get(dia)
  if (!d) {
    d = { dia, visualizacoes: 0, visitantes: 0, roteados: 0, chegaram: 0, connectRate: null, cliquesCheckout: 0, vendas: 0, receita: 0 }
    map.set(dia, d)
  }
  return d
}

export function buildVariantTimeline(linhas: LinhasCruas): DiaVariante[] {
  const dias = new Map<string, DiaVariante>()

  // uids que viram, por dia — base de tudo que é interseção.
  const viramPorDia = new Map<string, Set<string>>()
  for (const i of linhas.impressoes) {
    const d = ensure(dias, i.dia)
    d.visualizacoes++
    if (!viramPorDia.has(i.dia)) viramPorDia.set(i.dia, new Set())
    viramPorDia.get(i.dia)!.add(i.uid)
  }
  for (const [dia, set] of viramPorDia) ensure(dias, dia).visitantes = set.size

  // Roteados e quantos chegaram — interseção DENTRO do mesmo dia (numerador ⊆ denominador).
  const roteadosPorDia = new Map<string, Set<string>>()
  for (const r of linhas.routeClicks) {
    if (!roteadosPorDia.has(r.dia)) roteadosPorDia.set(r.dia, new Set())
    roteadosPorDia.get(r.dia)!.add(r.uid)
  }
  for (const [dia, roteados] of roteadosPorDia) {
    const d = ensure(dias, dia)
    const viram = viramPorDia.get(dia) ?? new Set<string>()
    let chegaram = 0
    for (const uid of roteados) if (viram.has(uid)) chegaram++
    d.roteados = roteados.size
    d.chegaram = chegaram
    d.connectRate = roteados.size > 0 ? (chegaram / roteados.size) * 100 : null
  }

  // Cliques pro checkout: só uid (identidade exata). Linha sem uid (tráfego direto, sem
  // cookie) não entra — contar cid aqui misturaria identidades e inflaria o número.
  const cliquesPorDia = new Map<string, Set<string>>()
  for (const h of linhas.checkoutHits) {
    if (!h.uid) continue
    if (!cliquesPorDia.has(h.dia)) cliquesPorDia.set(h.dia, new Set())
    cliquesPorDia.get(h.dia)!.add(h.uid)
  }
  for (const [dia, cliques] of cliquesPorDia) {
    const d = ensure(dias, dia)
    const viram = viramPorDia.get(dia) ?? new Set<string>()
    // Só conta quem VIU esta variante — clique de quem veio por outro caminho não é dela.
    let n = 0
    for (const uid of cliques) if (viram.has(uid)) n++
    d.cliquesCheckout = n
  }

  for (const v of linhas.vendas) {
    const d = ensure(dias, v.dia)
    d.vendas++
    d.receita += v.valor
  }

  return [...dias.values()].sort((a, b) => b.dia.localeCompare(a.dia)) // mais recente primeiro
}
