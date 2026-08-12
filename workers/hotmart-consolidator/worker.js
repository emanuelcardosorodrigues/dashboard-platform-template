// ─────────────────────────────────────────────
// HOTMART CONSOLIDATOR — Cloudflare Workers
// Estado das orders em D1 (sem KV). Logging em D1.
// Mesma lógica de consolidação da versão 08/mai; só o storage mudou KV → D1.
// ─────────────────────────────────────────────

export default {

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── Health check ─────────────────────────
    if (url.pathname === '/health') {
      return json({ status: 'ok', ts: Date.now() });
    }

    // ── Endpoint para consultar logs ──────────
    if (url.pathname === '/logs' && request.method === 'GET') {
      return handleLogsQuery(request, env);
    }

    if (url.pathname !== '/webhook' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }

    // ── Captura headers originais da Hotmart ──
    const originalHeaders = {};
    for (const [key, value] of request.headers.entries()) {
      if (!key.startsWith('cf-') && key !== 'host') {
        originalHeaders[key] = value;
      }
    }

    // ── Parse do payload ─────────────────────
    let payload;
    try {
      payload = await request.json();
    } catch {
      await log(env, 'system', 1, 'webhook_received', { error: 'Invalid JSON' }, 'error');
      return new Response('Invalid JSON', { status: 400 });
    }

    const eventType = payload.event ?? 'UNKNOWN';

    // ── Eventos não-Purchase → repassa direto ─
    if (eventType !== 'PURCHASE_APPROVED') {
      const executionId = `direct__${eventType}__${Date.now()}`;
      await log(env, executionId, 1, 'webhook_received', {
        event: eventType,
        action: 'forward_direct'
      }, 'info');

      const fwResult = await forwardToStape(payload, originalHeaders, env);

      await log(env, executionId, 2, 'forward_direct', {
        event: eventType,
        stapeStatus: fwResult.status,
        error: fwResult.error ?? null
      }, fwResult.ok ? 'success' : 'error');

      return json({ forwarded: true, event: eventType });
    }

    // ── Chave de agrupamento: xcod (primário) ou email + dia (fallback) ──
    const xcod       = payload.data?.purchase?.origin?.xcod ?? '';
    const email      = payload.data?.buyer?.email ?? '';
    const approvedAt = payload.data?.purchase?.approved_date ?? Date.now();
    const dayKey     = new Date(approvedAt).toISOString().slice(0, 10);
    const orderKey   = xcod
      ? `order__xcod__${xcod}`
      : `order__${email}__${dayKey}`;

    const transaction  = payload.data?.purchase?.transaction ?? '';
    const productType  = detectProductType(payload);
    const productId    = payload.data?.product?.id ?? null;
    const productName  = payload.data?.product?.name ?? null;
    const value        = payload.data?.purchase?.price?.value ?? 0;
    const currency     = payload.data?.purchase?.price?.currency_value ?? 'BRL';
    const producerComm = (payload.data?.commissions ?? [])
      .filter(c => c.source === 'PRODUCER')
      .reduce((s, c) => s + (c.value ?? 0), 0);

    // ── Log: webhook recebido ─────────────────
    await log(env, orderKey, 1, 'webhook_received', {
      email,
      transaction,
      productType,
      productName,
      productId,
      value,
      producerCommission: producerComm,
      xcod,
      sck: payload.data?.purchase?.origin?.sck ?? '',
      orderKeyType: xcod ? 'xcod' : 'email_day_fallback',
    }, 'success');

    if (!email) {
      await log(env, orderKey, 2, 'webhook_received', {
        error: 'Email não encontrado — repassando direto'
      }, 'error');
      await forwardToStape(payload, originalHeaders, env);
      return json({ forwarded: true, reason: 'no_email' });
    }

    const now = Date.now();

    // ── Estado no D1 (atômico) ────────────────
    // INSERT OR IGNORE em orders cria a order só na 1ª vez.
    // INSERT OR IGNORE em order_items (txn = PK) garante dedup.
    // SELECT fired decide se a order já foi consolidada.
    let firedRow;
    let itemInserted = false;
    try {
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO orders (order_key, fired, created_at, original_headers)
           VALUES (?, 0, ?, ?)`
        ).bind(orderKey, now, JSON.stringify(originalHeaders)),
        env.DB.prepare(
          `INSERT OR IGNORE INTO order_items
             (txn, order_key, product_id, product_name, product_type, value, producer_commission, currency, approved_at, raw_payload, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          transaction, orderKey, productId, productName, productType,
          value, producerComm, currency, approvedAt, JSON.stringify(payload), now
        ),
        env.DB.prepare(`SELECT fired FROM orders WHERE order_key = ?`).bind(orderKey),
      ]);
      itemInserted = (results[1].meta?.changes ?? 0) > 0;
      firedRow     = results[2].results?.[0];
    } catch (err) {
      await log(env, orderKey, 2, 'd1_write', { error: err.message }, 'error');
      return new Response('D1 error', { status: 500 });
    }

    // ── Já foi disparado ──────────────────────
    if (firedRow?.fired) {
      await log(env, orderKey, 2, 'd1_already_fired', {
        transaction,
        action: 'ignored'
      }, 'info');
      return json({ status: 'already_fired' });
    }

    // ── Duplicata (txn já existia) ────────────
    if (!itemInserted) {
      await log(env, orderKey, 2, 'd1_duplicate', {
        transaction,
        action: 'ignored'
      }, 'info');
      return json({ status: 'duplicate' });
    }

    // ── Conta itens (só pra log/resposta) ─────
    let itemCount = null;
    try {
      const c = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM order_items WHERE order_key = ?`
      ).bind(orderKey).first();
      itemCount = c?.n ?? null;
    } catch { /* contagem é best-effort */ }

    await log(env, orderKey, 3, 'd1_saved', {
      transaction,
      productName,
      value,
      producerCommission: producerComm,
      totalItems: itemCount,
      windowMinutes: Math.round(parseInt(env.WINDOW_MS ?? '1200000') / 60000),
    }, 'success');

    console.log(`D1 atualizado | ${orderKey} | ${itemCount} produto(s)`);

    return json({
      received: true,
      orderKey,
      productType,
      itemCount,
    });
  },

  // ── Cron: roda a cada 1 minuto ────────────
  // Consulta o D1 por orders cuja janela já fechou (usa idx_orders_pending).
  async scheduled(event, env, ctx) {
    const windowMs = parseInt(env.WINDOW_MS ?? '1200000');
    const now      = Date.now();
    const cutoff   = now - windowMs;

    let pending = [];
    try {
      const result = await env.DB.prepare(
        `SELECT order_key, created_at, original_headers
         FROM orders
         WHERE fired = 0 AND created_at <= ?`
      ).bind(cutoff).all();
      pending = result.results ?? [];
    } catch (err) {
      await log(env, 'cron', 1, 'cron_start', { error: err.message }, 'error');
      return;
    }

    // Nada pendente → encerra sem logar (economiza writes no minuto vazio)
    if (pending.length === 0) return;

    await log(env, 'cron', 1, 'cron_start', {
      pendingKeys: pending.length,
      ts: new Date().toISOString(),
    }, 'info');

    console.log(`Cron rodando — ${pending.length} pedido(s) prontos`);

    for (const row of pending) {
      try {
        await consolidateAndForward(row, env);
      } catch (err) {
        await log(env, row.order_key, 6, 'waster_exception', { error: err.message }, 'error');
        console.error(`❌ Exceção | ${row.order_key}:`, err.message);
      }
    }
  },
};

// ─────────────────────────────────────────────
// CONSOLIDAÇÃO
// ─────────────────────────────────────────────
async function consolidateAndForward(orderRow, env) {
  const orderKey        = orderRow.order_key;
  const originalHeaders = orderRow.original_headers ? JSON.parse(orderRow.original_headers) : {};

  // ── Marca como fired ANTES, de forma atômica (guarda contra double-fire) ──
  const claim = await env.DB.prepare(
    `UPDATE orders SET fired = 1, fired_at = ? WHERE order_key = ? AND fired = 0`
  ).bind(Date.now(), orderKey).run();
  if ((claim.meta?.changes ?? 0) === 0) return; // outro tick já pegou esta order

  // ── Carrega os itens da order ─────────────
  const itemsRes = await env.DB.prepare(
    `SELECT * FROM order_items WHERE order_key = ?`
  ).bind(orderKey).all();
  const rows = itemsRes.results ?? [];
  if (rows.length === 0) return;

  const items = rows.map(r => ({
    transaction:        r.txn,
    productType:        r.product_type,
    productId:          r.product_id,
    productName:        r.product_name,
    value:              r.value,
    producerCommission: r.producer_commission,
    currency:           r.currency,
    approvedAt:         r.approved_at,
    rawPayload:         JSON.parse(r.raw_payload),
  }));

  // ── Log: início da consolidação ───────────
  await log(env, orderKey, 4, 'consolidation_start', {
    productCount: items.length,
    products: items.map(i => ({
      name: i.productName,
      transaction: i.transaction,
      value: i.value,
      producerCommission: i.producerCommission,
    }))
  }, 'info');

  // ── Front = menor approvedAt ──────────────
  const front = items.reduce((a, b) => a.approvedAt <= b.approvedAt ? a : b);
  const frontPayload = front.rawPayload;

  const xcod = frontPayload?.data?.purchase?.origin?.xcod ?? '';
  const sck  = frontPayload?.data?.purchase?.origin?.sck  ?? '';

  // ── Somas ─────────────────────────────────
  const totalGross    = parseFloat(items.reduce((s, i) => s + (i.value ?? 0), 0).toFixed(2));
  const totalProducer = parseFloat(items.reduce((s, i) => s + (i.producerCommission ?? 0), 0).toFixed(2));
  const totalMarket   = parseFloat(items.reduce((s, i) => {
    const comms = i.rawPayload?.data?.commissions ?? [];
    return s + comms.filter(c => c.source === 'MARKETPLACE').reduce((a, c) => a + (c.value ?? 0), 0);
  }, 0).toFixed(2));

  // ── Log: dados da consolidação ────────────
  await log(env, orderKey, 5, 'consolidation_data', {
    frontProduct:      front.productName,
    frontTransaction:  front.transaction,
    xcod,
    sck,
    totalGross,
    totalProducer,
    totalMarket,
    productIds: items.map(i => i.productId),
  }, 'info');

  console.log(`Consolidando | ${orderKey} | ${items.length} produto(s)`);
  console.log(`Bruto: R$${totalGross} | Produtor: R$${totalProducer}`);
  console.log(`xcod: ${xcod || '⚠️ VAZIO'}`);

  // ── Monta payload consolidado ─────────────
  const consolidatedPayload = JSON.parse(JSON.stringify(frontPayload));

  consolidatedPayload.data.purchase.price.value                = totalGross;
  consolidatedPayload.data.purchase.full_price.value           = totalGross;
  consolidatedPayload.data.purchase.original_offer_price.value = totalGross;

  consolidatedPayload.data.commissions = [
    { source: 'MARKETPLACE', value: totalMarket,   currency_value: items[0]?.currency ?? 'BRL' },
    { source: 'PRODUCER',    value: totalProducer, currency_value: items[0]?.currency ?? 'BRL' },
  ];

  if (items.length > 1) {
    consolidatedPayload.data.product.id = items.map(i => i.productId).join(',');
  }
  consolidatedPayload.data.purchase.product_ids = items.map(i => i.productId);

  consolidatedPayload._consolidated = {
    orderKey,
    productCount: items.length,
    totalGross,
    totalProducer,
    products: items.map(i => ({
      name:          i.productName,
      type:          i.productType,
      valueGross:    i.value,
      valueProducer: i.producerCommission,
      transaction:   i.transaction,
      productId:     i.productId,
    })),
    consolidatedAt: new Date().toISOString(),
  };

  // ── Envia para a Stape ────────────────────
  const endpoint = env.STAPE_ENDPOINT;
  if (!endpoint) {
    await log(env, orderKey, 6, 'waster_error', {
      error: 'STAPE_ENDPOINT não configurado'
    }, 'error');
    console.error('STAPE_ENDPOINT não configurado!');
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { ...originalHeaders, 'Content-Type': 'application/json' },
      body:    JSON.stringify(consolidatedPayload),
    });

    const responseText = await response.text();

    if (response.ok) {
      await log(env, orderKey, 6, 'waster_success', {
        status:       response.status,
        totalGross,
        totalProducer,
        productCount: items.length,
        productIds:   items.map(i => i.productId),
        xcod,
      }, 'success');
      console.log(`✅ Stape OK | ${orderKey} | status: ${response.status}`);
    } else {
      await log(env, orderKey, 6, 'waster_error', {
        status:       response.status,
        responseBody: responseText.slice(0, 500),
      }, 'error');
      console.error(`❌ Stape erro | ${orderKey} | status: ${response.status}`);
    }

    await env.DB.prepare(
      `UPDATE orders SET stape_status = ? WHERE order_key = ?`
    ).bind(response.status, orderKey).run();

  } catch (err) {
    await log(env, orderKey, 6, 'waster_exception', {
      error: err.message
    }, 'error');
    console.error(`❌ Exceção | ${orderKey}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// FORWARD DIRETO (eventos não-Purchase)
// ─────────────────────────────────────────────
async function forwardToStape(payload, originalHeaders, env) {
  const endpoint = env.STAPE_ENDPOINT;
  if (!endpoint) return { ok: false, status: null, error: 'STAPE_ENDPOINT não configurado' };

  try {
    const response = await fetch(endpoint, {
      method:  'POST',
      headers: { ...originalHeaders, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    console.log(`Stape response: ${response.status}`);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    console.error('Erro ao repassar para Stape:', err.message);
    return { ok: false, status: null, error: err.message };
  }
}

// ─────────────────────────────────────────────
// DETECT PRODUCT TYPE
// ─────────────────────────────────────────────
function detectProductType(payload) {
  const purchase = payload.data?.purchase ?? {};
  if (purchase.order_bump?.is_order_bump === true) return 'order_bump';
  if (purchase.is_funnel === true) return 'upsell';
  const tx = purchase.transaction ?? '';
  if (tx.match(/C[2-9]$/) || tx.match(/C\d{2,}$/)) return 'upsell_or_bump';
  return 'front';
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// LOGGING NO D1
// ─────────────────────────────────────────────
async function log(env, executionId, step, stepName, content, type) {
  if (!env.DB) {
    console.log(`[LOG] ${type.toUpperCase()} | ${executionId} | step${step}:${stepName} | ${JSON.stringify(content)}`);
    return;
  }

  try {
    await env.DB.prepare(`
      INSERT INTO logs (execution_id, step, step_name, content, type, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      executionId,
      step,
      stepName,
      JSON.stringify(content),
      type
    ).run();
  } catch (err) {
    console.error(`[LOG ERROR] ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// QUERY DE LOGS (endpoint /logs)
// ─────────────────────────────────────────────
async function handleLogsQuery(request, env) {
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'D1 não configurado' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url    = new URL(request.url);
  const id     = url.searchParams.get('id');
  const type   = url.searchParams.get('type');
  const step   = url.searchParams.get('step');
  const limit  = parseInt(url.searchParams.get('limit') ?? '50');
  const date   = url.searchParams.get('date');

  let query  = 'SELECT * FROM logs WHERE 1=1';
  const args = [];

  if (id)   { query += ' AND execution_id LIKE ?'; args.push(`%${id}%`); }
  if (type) { query += ' AND type = ?';            args.push(type); }
  if (step) { query += ' AND step_name = ?';       args.push(step); }
  if (date) { query += ' AND date(created_at) = ?'; args.push(date); }

  query += ' ORDER BY created_at DESC LIMIT ?';
  args.push(limit);

  try {
    const result = await env.DB.prepare(query).bind(...args).all();
    const rows   = result.results.map(r => ({
      ...r,
      content: JSON.parse(r.content),
    }));

    return new Response(JSON.stringify({ total: rows.length, logs: rows }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
