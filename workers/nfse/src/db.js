// Camada de acesso ao D1. Todas as queries do worker passam por aqui.

export async function buscarProduto(env, product_id) {
  if (!product_id || !env.DB) return null;
  return env.DB.prepare('SELECT * FROM produtos WHERE product_id=?').bind(product_id).first();
}

export async function buscarNotaPorId(env, id) {
  return env.DB.prepare('SELECT * FROM notas WHERE id=?').bind(id).first();
}

export async function buscarNotaPorHotmartId(env, hotmartId) {
  return env.DB.prepare('SELECT id, numero_nfse, status, hotmart_id FROM notas WHERE hotmart_id=?').bind(hotmartId).first();
}

export async function salvarNota(env, dados) {
  if (!env.DB) return { skipped: false };
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO notas
     (numero_rps, numero_nfse, doc_tomador, nome_tomador, email_tomador, valor, status, origem, hotmart_id,
      xml_completo, drive_file_id, drive_link, product_id, nome_produto, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
  ).bind(
    String(dados.numero),
    dados.numero_nfse    ?? null,
    dados.docTomador     ?? null,
    dados.nomeTomador,
    dados.emailTomador   ?? null,
    dados.valorServicos,
    dados.status         ?? 'emitida',
    dados.origem,
    dados.hotmartId      ?? null,
    dados.xml_completo   ?? null,
    dados.drive_file_id  ?? null,
    dados.drive_link     ?? null,
    dados.product_id     ?? null,
    dados.nome_produto   ?? null,
  ).run();

  // P0-03: race-safe — UNIQUE INDEX em hotmart_id faz INSERT OR IGNORE pular duplicatas.
  // changes=0 indica que outro webhook concorrente já gravou a nota.
  return { skipped: (r?.meta?.changes ?? 0) === 0 };
}

export async function atualizarDriveNota(env, { hotmartId, numeroNfse, fileId, webViewLink }) {
  if (!fileId) return;
  if (hotmartId) {
    await env.DB.prepare('UPDATE notas SET drive_file_id=?, drive_link=? WHERE hotmart_id=?')
      .bind(fileId, webViewLink ?? null, hotmartId).run();
  } else if (numeroNfse) {
    await env.DB.prepare('UPDATE notas SET drive_file_id=?, drive_link=? WHERE numero_nfse=?')
      .bind(fileId, webViewLink ?? null, numeroNfse).run();
  }
}

export async function atualizarStatusNota(env, id, status, driveLink = undefined) {
  if (driveLink !== undefined) {
    await env.DB.prepare('UPDATE notas SET status=?, drive_link=? WHERE id=?').bind(status, driveLink, id).run();
  } else {
    await env.DB.prepare('UPDATE notas SET status=? WHERE id=?').bind(status, id).run();
  }
}

export async function emailAtivo(env) {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT valor FROM config WHERE chave='email_cliente_ativo'").first();
  return row?.valor === 'true';
}

export async function logWebhook(env, payload, resultado, mensagem) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_log (evento, product_id, transaction_id, payload_json, resultado, mensagem)
       VALUES (?,?,?,?,?,?)`
    ).bind(
      payload?.event ?? null,
      String(payload?.data?.product?.id ?? ''),
      payload?.data?.purchase?.transaction ?? null,
      JSON.stringify(payload).slice(0, 10000),
      resultado,
      mensagem,
    ).run();
  } catch (err) {
    console.error('logWebhook error:', err.message);
  }
}

// ─── Observabilidade ─────────────────────────────────────────────────────────

// Lista entradas do webhook_log com filtros opcionais.
// filters: { resultado?, since (ISO), limit (1..1000) }
export async function listarWebhookLog(env, filters = {}) {
  if (!env.DB) return [];
  const limit = Math.min(Math.max(parseInt(filters.limit ?? 100, 10) || 100, 1), 1000);
  const since = filters.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const where = ['criado_em >= ?'];
  const params = [since];
  if (filters.resultado) {
    where.push('resultado = ?');
    params.push(filters.resultado);
  }
  const sql = `SELECT id, evento, product_id, transaction_id, resultado,
                      substr(mensagem, 1, 500) AS mensagem,
                      substr(payload_json, 1, 2000) AS payload_preview,
                      criado_em
               FROM webhook_log
               WHERE ${where.join(' AND ')}
               ORDER BY criado_em DESC
               LIMIT ?`;
  params.push(limit);
  try {
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return results ?? [];
  } catch (err) {
    console.error('listarWebhookLog error:', err.message);
    return [];
  }
}

// Conta falhas de auth/erro na HORA atual (mesma hora do relógio, em UTC).
// Usado pra trigger de alerta — threshold ≥3 dispara email pra ops.
export async function countAuthFailsLastHour(env) {
  if (!env.DB) return { total: 0, ultima_msg: null, ultima_tx: null };
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              MAX(criado_em) AS ultima,
              MAX(mensagem) AS ultima_msg_any,
              MAX(transaction_id) AS ultima_tx_any
         FROM webhook_log
        WHERE (resultado LIKE 'auth_fail%' OR resultado = 'erro' OR resultado = 'config_missing')
          AND strftime('%Y-%m-%d %H', criado_em) = strftime('%Y-%m-%d %H', 'now')`
    ).first();
    // Pega o último por criado_em separadamente pra ter msg/tx coerentes
    const detalhe = await env.DB.prepare(
      `SELECT mensagem AS ultima_msg, transaction_id AS ultima_tx
         FROM webhook_log
        WHERE (resultado LIKE 'auth_fail%' OR resultado = 'erro' OR resultado = 'config_missing')
          AND strftime('%Y-%m-%d %H', criado_em) = strftime('%Y-%m-%d %H', 'now')
        ORDER BY criado_em DESC
        LIMIT 1`
    ).first();
    return {
      total: row?.total ?? 0,
      ultima_msg: detalhe?.ultima_msg ?? null,
      ultima_tx: detalhe?.ultima_tx ?? null,
    };
  } catch (err) {
    console.error('countAuthFailsLastHour error:', err.message);
    return { total: 0, ultima_msg: null, ultima_tx: null };
  }
}

// Conta falhas em uma janela arbitrária (em horas). Usado por /api/health e card admin.
export async function countAuthFailsWindow(env, hours = 24) {
  if (!env.DB) return 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM webhook_log
        WHERE (resultado LIKE 'auth_fail%' OR resultado = 'erro' OR resultado = 'config_missing')
          AND criado_em >= datetime('now', ?)`
    ).bind(`-${Math.max(1, Math.floor(hours))} hours`).first();
    return row?.total ?? 0;
  } catch (err) {
    console.error('countAuthFailsWindow error:', err.message);
    return 0;
  }
}

// Verifica se já enviou alerta nessa hora (idempotência de spam-trottle).
export async function alertaEnviadoNestaHora(env) {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM webhook_log
        WHERE resultado = 'alerta_enviado'
          AND strftime('%Y-%m-%d %H', criado_em) = strftime('%Y-%m-%d %H', 'now')
        LIMIT 1`
    ).first();
    return !!row;
  } catch (err) {
    console.error('alertaEnviadoNestaHora error:', err.message);
    return false;
  }
}

// Registra que um alerta foi enviado pra throttle por hora.
export async function salvarAlertaEnviado(env, mensagem) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_log (evento, product_id, transaction_id, payload_json, resultado, mensagem)
       VALUES (?,?,?,?,?,?)`
    ).bind(null, null, null, null, 'alerta_enviado', String(mensagem ?? '').slice(0, 500)).run();
  } catch (err) {
    console.error('salvarAlertaEnviado error:', err.message);
  }
}

// Última emissão automática bem-sucedida (resultado='emitida').
export async function ultimaEmissaoAutomatica(env) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT criado_em FROM webhook_log
        WHERE resultado = 'emitida'
        ORDER BY criado_em DESC LIMIT 1`
    ).first();
    return row?.criado_em ?? null;
  } catch (err) {
    console.error('ultimaEmissaoAutomatica error:', err.message);
    return null;
  }
}

// Sanidade do D1 — usada por /api/health.
export async function dbReachable(env) {
  if (!env.DB) return false;
  try {
    const row = await env.DB.prepare('SELECT 1 AS ok').first();
    return row?.ok === 1;
  } catch (err) {
    console.error('dbReachable error:', err.message);
    return false;
  }
}
