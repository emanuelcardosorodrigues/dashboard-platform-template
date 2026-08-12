/**
 * Reconciliação dos dois streams que formam o connect rate, pra pegar quebra silenciosa:
 *   - route_clicks (302 do Worker) = cliques roteados
 *   - impressions  (beacon /r/i)   = views reais na página
 *
 * Em modo beacon, TODA impression vem de uma visita roteada (o beacon só dispara com
 * `?_abp=`, que só o 302 injeta). Logo, por construção: roteados ≥ views ≥ landed.
 * Quando essa ordem quebra, um dos dois lados parou de gravar:
 *   - views > 0 mas roteados == 0  → o 302 não está logando (roteamento/insert quebrado)
 *   - muitos roteados mas quase ninguém chega → beacon da página quebrado / página morta
 *
 * É função pura: o endpoint monta as linhas por SQL e passa pra cá. Sem I/O aqui.
 */

export interface StreamRow {
  experimentId: string
  name: string
  routed: number   // uids distintos em route_clicks na janela
  landed: number   // uids roteados que também apareceram em impressions (interseção)
  views: number    // uids distintos em impressions na janela
}

export interface StreamIssue {
  experimentId: string
  name: string
  kind: 'roteamento-parado' | 'beacon-suspeito'
  detalhe: string
}

export interface ReconcileOpts {
  minSample: number   // só acusa "beacon-suspeito" com amostra que valha (senão é ruído)
  floorPct: number    // connect rate abaixo disto, com amostra, é suspeito
  viewsFloor: number  // ignora trickle: só acusa "roteamento-parado" acima disto de views
}

/**
 * Retorna os problemas encontrados (vazio = tudo reconciliado). NÃO decide o HTTP status —
 * o endpoint faz isso (503 se houver issue). Cada issue nomeia QUAL lado caiu, pra o alerta
 * apontar o dedo em vez de dizer só "algo quebrou".
 */
export function reconcileConnectStreams(rows: StreamRow[], opts: ReconcileOpts): StreamIssue[] {
  const issues: StreamIssue[] = []
  for (const r of rows) {
    // Roteamento parado: página teve view (logo, foi roteada) mas nenhum clique gravado.
    if (r.routed === 0 && r.views > opts.viewsFloor) {
      issues.push({
        experimentId: r.experimentId,
        name: r.name,
        kind: 'roteamento-parado',
        detalhe: `${r.views} views mas 0 cliques roteados gravados — o 302 não está logando route_clicks`,
      })
      continue // sem roteados não dá pra avaliar o beacon
    }
    // Beacon suspeito: gente foi roteada mas quase ninguém chegou na página.
    if (r.routed >= opts.minSample) {
      const rate = (r.landed / r.routed) * 100
      if (rate < opts.floorPct) {
        issues.push({
          experimentId: r.experimentId,
          name: r.name,
          kind: 'beacon-suspeito',
          detalhe: `connect rate ${rate.toFixed(0)}% (${r.landed}/${r.routed}) abaixo de ${opts.floorPct}% — beacon da página quebrado ou página não carrega`,
        })
      }
    }
  }
  return issues
}
