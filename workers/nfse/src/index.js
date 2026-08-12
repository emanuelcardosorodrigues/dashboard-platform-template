import { buildRpsXml, buildCabecalho, buildCancelamentoXml } from './xml.js'
import { signXml }                                          from './sign.js'
import { enviarNfse, cancelarNfse }                         from './webiss.js'
import { handleAdmin }                                      from './admin.js'
import { uploadNotaToDrive, moverNotaParaCanceladas, deletarArquivoDrive } from './drive.js'
import { gerarDanfsePdf } from './pdf.js'
import { enviarEmailNota, enviarAlertaOps }                 from './email.js'
import {
  buscarProduto, buscarNotaPorId, buscarNotaPorHotmartId,
  salvarNota, atualizarDriveNota, atualizarStatusNota,
  emailAtivo, logWebhook,
  listarWebhookLog, countAuthFailsLastHour, countAuthFailsWindow,
  alertaEnviadoNestaHora, salvarAlertaEnviado,
  ultimaEmissaoAutomatica, dbReachable,
} from './db.js'

const DEFAULT_CODIGO_SERVICO = '0000'
const DEFAULT_PERCENTUAL = 100

function emissor(env) {
  return {
    cnpj: env.NFSE_PROVIDER_CNPJ || '00000000000000',
    im: env.NFSE_PROVIDER_MUNICIPAL_REGISTRATION || '0000000',
    serviceCode: env.NFSE_SERVICE_CODE || DEFAULT_CODIGO_SERVICO,
    defaultPercent: Number(env.NFSE_DEFAULT_PERCENT || DEFAULT_PERCENTUAL),
    municipalityCode: env.NFSE_MUNICIPALITY_CODE || '0000000',
    state: env.NFSE_PROVIDER_STATE || 'UF',
    postalCode: env.NFSE_PROVIDER_POSTAL_CODE || '00000000',
  }
}

// Emitir SOMENTE em vendas definitivas (garantia expirada).
// PURCHASE_APPROVED dispara logo após aprovação do pagamento (ainda em garantia)
// e foi removido propositalmente para evitar emitir nota de venda que pode
// ser reembolsada — economiza emissão+cancelamento e risco de cancel falho.
const EVENTOS_EMISSAO = new Set(['PURCHASE_COMPLETE'])

// Eventos que devem disparar cancelamento automático da nota emitida
const EVENTOS_CANCELAMENTO = new Set(['PURCHASE_REFUNDED', 'PURCHASE_CANCELED', 'PURCHASE_CHARGEBACK', 'PURCHASE_PROTEST', 'CHARGEBACK'])

function requireApiKey(request, env) {
  if (request.headers.get('x-api-key') !== env.API_KEY) {
    return json({ erro: 'não autorizado' }, 401)
  }
  return null
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/admin'))
      return handleAdmin(request, env)

    if (url.pathname === '/webhook/hotmart' && request.method === 'POST')
      return handleHotmart(request, env)

    // /api/health é público (não vaza secrets, só presença bool)
    if (url.pathname === '/api/health')
      return handleHealth(request, env)

    // Rotas /api/* e /emitir exigem x-api-key (CORS preflight é isento)
    if (url.pathname.startsWith('/api/') || url.pathname === '/emitir') {
      if (request.method === 'OPTIONS' && url.pathname === '/api/produtos')
        return handleProdutosApi(request, env)

      const authErr = requireApiKey(request, env)
      if (authErr) return authErr

      if (url.pathname === '/api/webhook-log')
        return handleWebhookLogApi(request, env)

      if (url.pathname === '/api/produtos')
        return handleProdutosApi(request, env)
      if (url.pathname === '/api/notas')
        return handleListarNotas(request, env)
      if (url.pathname.match(/^\/api\/notas\/\d+\/xml$/))
        return handleNotaXml(request, env)
      if (request.method === 'POST' && url.pathname.match(/^\/api\/notas\/\d+\/cancelar$/))
        return handleCancelarNota(request, env)
      if (request.method === 'POST' && url.pathname.match(/^\/api\/notas\/\d+\/drive-retry$/))
        return handleDriveRetry(request, env)
      if (request.method === 'POST' && url.pathname.match(/^\/api\/notas\/\d+\/atualizar-produto$/))
        return handleAtualizarProduto(request, env)
      if (request.method === 'POST' && url.pathname.match(/^\/api\/notas\/\d+\/regerar-pdf$/))
        return handleRegerarPdfDrive(request, env)
      if (url.pathname === '/api/admin/drive-list-pdfs')
        return handleDriveListPdfs(request, env)
      if (url.pathname === '/api/config/email' && request.method === 'POST')
        return handleToggleEmail(request, env)
      if (url.pathname === '/emitir' && request.method === 'POST')
        return handleEmissaoManual(request, env)
    }

    return new Response('NFS-e Worker OK', { status: 200 })
  },
}

// ─── Webhook Hotmart ─────────────────────────────────────────────────────────

// Verificação HMAC timing-safe, case-insensitive, early-fail.
// crypto.subtle.verify é constant-time por especificação WebCrypto.
async function verifyHotmartHmac(rawBody, secret, signature) {
  if (!secret || !signature) return false
  const normalized = signature.toLowerCase().replace(/^sha256=/, '')
  if (!/^[0-9a-f]{64}$/.test(normalized)) return false
  const sigBytes = new Uint8Array(normalized.match(/.{2}/g).map(h => parseInt(h, 16)))
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(rawBody))
}

async function handleHotmart(request, env) {
  const issuer = emissor(env)
  // Boot-time guard: HOTMART_TOKEN ausente ou inválido → 503 (sinaliza problema do
  // servidor, não da requisição; Hotmart retenta com backoff exponencial).
  if (!env.HOTMART_TOKEN || env.HOTMART_TOKEN.length < 16) {
    console.error('HOTMART_TOKEN ausente ou inválido em runtime')
    try { await logWebhook(env, {}, 'config_missing', 'HOTMART_TOKEN ausente ou < 16 chars') }
    catch (e) { console.error('logWebhook falhou (config_missing):', e) }
    return json({ erro: 'configuração ausente' }, 503)
  }

  // Ler body como texto antes de qualquer consumo (necessário para HMAC)
  let rawBody
  try { rawBody = await request.text() }
  catch (e) {
    console.error('erro ao ler body:', e)
    return json({ erro: 'erro ao ler body' }, 400)
  }

  // Validação de assinatura: HMAC-only (sem fallback hottok).
  const hmacSig = request.headers.get('x-hotmart-signature')
  if (!hmacSig) {
    try { await logWebhook(env, { raw: rawBody.slice(0, 500) }, 'auth_fail_hmac_missing', 'x-hotmart-signature ausente') }
    catch (e) { console.error('logWebhook falhou (auth_fail_hmac_missing):', e) }
    await maybeAlertOps(env, { resultado: 'auth_fail_hmac_missing', mensagem: 'x-hotmart-signature ausente' })
    return json({ erro: 'assinatura ausente' }, 401)
  }
  const ok = await verifyHotmartHmac(rawBody, env.HOTMART_TOKEN, hmacSig)
  if (!ok) {
    const preview = hmacSig.slice(0, 16) + '...' + hmacSig.slice(-8)
    try { await logWebhook(env, { raw: rawBody.slice(0, 500) }, 'auth_fail_hmac', `HMAC inválido (sig=${preview})`) }
    catch (e) { console.error('logWebhook falhou (auth_fail_hmac):', e) }
    await maybeAlertOps(env, { resultado: 'auth_fail_hmac', mensagem: `HMAC inválido (sig=${preview})` })
    return json({ erro: 'assinatura inválida' }, 401)
  }

  let payload
  try { payload = JSON.parse(rawBody) }
  catch { return json({ erro: 'payload inválido' }, 400) }

  // P1-05: refund/cancel/chargeback → cancelar nota se existir
  if (EVENTOS_CANCELAMENTO.has(payload?.event)) {
    return handleHotmartCancelamento(env, payload)
  }

  // Aceitar somente PURCHASE_COMPLETE (venda definitiva, garantia expirada)
  if (!EVENTOS_EMISSAO.has(payload?.event)) {
    await logWebhook(env, payload, 'ignorada_evento', `evento ${payload?.event}`)
    return json({ ok: true, ignorado: payload?.event })
  }

  const purchase = payload?.data?.purchase
  const buyer    = payload?.data?.buyer
  const product  = payload?.data?.product

  const produto = await buscarProduto(env, String(product?.id ?? ''))
  if (!produto) {
    // P0-06: registrar produto não configurado em vez de perder silenciosamente
    await logWebhook(env, payload, 'ignorada_produto', String(product?.id ?? ''))
    return json({ ok: true, ignorado: `produto ${product?.id} não configurado` })
  }

  // P0-05: idempotência — rejeitar webhook já processado
  const transactionId = purchase?.transaction ?? null
  if (transactionId) {
    const ja = await buscarNotaPorHotmartId(env, transactionId)
    if (ja) {
      await logWebhook(env, payload, 'ignorada_duplicada', `nota ${ja.numero_nfse}`)
      return json({ ok: true, ja_emitida: true, numeroNfse: ja.numero_nfse })
    }
  }

  // P0-02: preferir price (valor pago) em vez de original_offer_price (pré-cupom)
  const valorBruto    = purchase?.price?.value ?? purchase?.full_price?.value ?? 0
  if (!valorBruto) {
    await logWebhook(env, payload, 'erro', 'valor zero ou ausente')
    return json({ erro: 'valor da compra ausente' }, 400)
  }
  const valorServicos = +(valorBruto * produto.percentual / 100).toFixed(2)

  const dados = {
    numero:        gerarNumeroRps(),
    serie:         'RPS',
    valorServicos,
    descricao:     `${product?.name ?? 'Infoproduto'} - ${produto.percentual}% co-produção`,
    codigoServico: issuer.serviceCode,
    cnpjPrestador: issuer.cnpj,
    imPrestador:   issuer.im,
    municipalityCode: issuer.municipalityCode,
    tomadorState: issuer.state,
    tomadorPostalCode: issuer.postalCode,
    docTomador:    limparDoc(buyer?.document ?? ''),
    nomeTomador:   buyer?.name ?? 'Não informado',
    emailTomador:  buyer?.email ?? '',
  }

  // P1-14: usar ENVIRONMENT para controlar produção vs homologação
  const producao = env.ENVIRONMENT === 'production'

  try {
    // Fase 1: emitir — abortar tudo em falha
    const resultado = await emitir(dados, env, producao)

    // Fase 2: salvar nota imediatamente com drive_link=null
    // P0-03: race-safe — se outro webhook concorrente já emitiu, o INSERT OR IGNORE
    // pelo UNIQUE INDEX em hotmart_id evita duplicação. Detectamos via rowsWritten.
    const insertRes = await salvarNota(env, {
      ...dados,
      numero_nfse:   resultado.numero,
      xml_completo:  resultado.xmlCompleto,
      drive_file_id: null,
      drive_link:    null,
      status:        'emitida',
      origem:        producao ? 'hotmart' : 'hotmart-homologacao',
      hotmartId:     transactionId,
      product_id:    produto.product_id,
      nome_produto:  produto.nome,
    })
    if (insertRes?.skipped) {
      await logWebhook(env, payload, 'ignorada_duplicada_race', `nfse ${resultado.numero} já registrada`)
      return json({ ok: true, ja_emitida: true, numeroNfse: resultado.numero })
    }

    await logWebhook(env, payload, 'emitida', `nfse ${resultado.numero}`)

    // Fase 3: Drive best-effort — atualiza nota se tiver sucesso
    const driveInfo = await uploadDrive(env, resultado.xmlCompleto, dados, produto, 'emitida', { numero_nfse: resultado.numero, valor: dados.valorServicos })
    await atualizarDriveNota(env, { hotmartId: transactionId, fileId: driveInfo.fileId, webViewLink: driveInfo.webViewLink })

    // Fase 4: email best-effort
    let emailRes = null
    if (await emailAtivo(env)) {
      emailRes = await enviarEmailNota(env, { tipo: 'emitida', nomeTomador: dados.nomeTomador, emailTomador: dados.emailTomador, numeroNfse: resultado.numero, driveLink: driveInfo.webViewLink ?? null, valorServicos: dados.valorServicos, docTomador: dados.docTomador })
      if (!emailRes.ok) console.error('email_falha', JSON.stringify(emailRes))
    }

    return json({
      ok: true,
      numeroNfse: resultado.numero,
      ...(driveInfo.error ? { driveError: driveInfo.error } : {}),
      ...(emailRes && !emailRes.ok ? { emailError: emailRes.body } : {}),
    })
  } catch (err) {
    await logWebhook(env, payload, 'erro', err.message)
    await maybeAlertOps(env, { resultado: 'erro', mensagem: err.message, transactionId })
    return json({ erro: err.message }, 500)
  }
}

// ─── Webhook Hotmart: cancelamento ──────────────────────────────────────────

async function handleHotmartCancelamento(env, payload) {
  const transactionId = payload?.data?.purchase?.transaction ?? null
  if (!transactionId) {
    await logWebhook(env, payload, 'ignorada_cancel_sem_tx', `evento ${payload?.event} sem transaction`)
    return json({ ok: true, ignorado: 'cancelamento sem transaction' })
  }

  const nota = await buscarNotaPorHotmartId(env, transactionId)
  if (!nota || !nota.numero_nfse) {
    await logWebhook(env, payload, 'ignorada_cancel_sem_nota', `tx ${transactionId} sem nota emitida`)
    return json({ ok: true, ignorado: 'nenhuma nota emitida para esta transaction' })
  }

  if (nota.status === 'cancelada' || nota.status === 'cancelando') {
    await logWebhook(env, payload, 'ignorada_cancel_duplicada', `nota ${nota.numero_nfse} status=${nota.status}`)
    return json({ ok: true, ja_cancelada: true })
  }

  // Reaproveita pipeline manual de cancelamento
  const fakeReq = new Request(`http://internal/api/notas/${nota.id}/cancelar`, {
    method: 'POST',
    headers: { 'x-api-key': env.API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: '2' }),
  })
  const res = await handleCancelarNota(fakeReq, env)
  const txt = await res.clone().text()
  await logWebhook(env, payload, res.ok ? 'cancelada_via_webhook' : 'erro_cancelamento_webhook', txt.slice(0, 500))
  return res
}

// ─── Emissão manual ──────────────────────────────────────────────────────────

async function handleEmissaoManual(request, env) {
  const issuer = emissor(env)
  let body
  try { body = await request.json() }
  catch { return json({ erro: 'payload inválido' }, 400) }

  const docTomador = limparDoc(body.docTomador ?? body.cpfTomador ?? '')
  if (!body.valorServicos) return json({ erro: 'campo obrigatório: valorServicos' }, 400)
  if (!body.nomeTomador)   return json({ erro: 'campo obrigatório: nomeTomador' }, 400)
  if (!docTomador)         return json({ erro: 'campo obrigatório: docTomador (CPF ou CNPJ)' }, 400)

  const produto  = await buscarProduto(env, body.product_id ?? '') ?? { product_id: body.product_id || 'sem-produto', nome: 'Sem Produto', percentual: issuer.defaultPercent }
  const producao = body.producao === true

  const payload = {
    numero:        gerarNumeroRps(),
    serie:         'RPS',
    codigoServico: issuer.serviceCode,
    cnpjPrestador: issuer.cnpj,
    imPrestador:   issuer.im,
    municipalityCode: issuer.municipalityCode,
    tomadorState: issuer.state,
    tomadorPostalCode: issuer.postalCode,
    descricao:     body.descricao || `${produto.nome} - ${produto.percentual}% co-produção`,
    valorServicos: body.valorServicos,
    nomeTomador:   body.nomeTomador,
    emailTomador:  body.emailTomador ?? '',
    docTomador,
  }

  try {
    const resultado = await emitir(payload, env, producao)

    await salvarNota(env, {
      ...payload,
      numero_nfse:   resultado.numero,
      xml_completo:  resultado.xmlCompleto,
      drive_file_id: null,
      drive_link:    null,
      status:        'emitida',
      origem:        producao ? 'manual' : 'manual-homologacao',
      product_id:    produto.product_id,
      nome_produto:  produto.nome,
    })

    const driveInfo = await uploadDrive(env, resultado.xmlCompleto, payload, produto, 'emitida', { numero_nfse: resultado.numero, valor: payload.valorServicos })
    await atualizarDriveNota(env, { numeroNfse: resultado.numero, fileId: driveInfo.fileId, webViewLink: driveInfo.webViewLink })

    let emailRes = null
    if (await emailAtivo(env)) {
      emailRes = await enviarEmailNota(env, { tipo: 'emitida', nomeTomador: payload.nomeTomador, emailTomador: payload.emailTomador, numeroNfse: resultado.numero, driveLink: driveInfo.webViewLink ?? null, valorServicos: payload.valorServicos, docTomador: payload.docTomador })
      if (!emailRes.ok) console.error('email_falha', JSON.stringify(emailRes))
    }

    return json({
      ok: true,
      numeroNfse: resultado.numero,
      codigoVerificacao: resultado.codigoVerificacao,
      driveLink: driveInfo.webViewLink ?? null,
      ...(driveInfo.error ? { driveError: driveInfo.error } : {}),
      ...(emailRes && !emailRes.ok ? { emailError: emailRes.body } : {}),
    })
  } catch (err) {
    return json({ erro: err.message }, 500)
  }
}

// ─── Listar notas ────────────────────────────────────────────────────────────

async function handleListarNotas(request, env) {
  const url    = new URL(request.url)
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  ?? '200'), 500)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const { results } = await env.DB.prepare(
    `SELECT id, numero_rps, numero_nfse, doc_tomador, nome_tomador, valor,
            origem, hotmart_id, drive_link, product_id, nome_produto, status, criado_em
     FROM notas ORDER BY criado_em DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all()

  return json(results)
}

// ─── Cancelar nota ───────────────────────────────────────────────────────────

async function handleCancelarNota(request, env) {
  const id   = new URL(request.url).pathname.split('/')[3]
  const nota = await buscarNotaPorId(env, id)
  if (!nota)                    return json({ erro: 'nota não encontrada' }, 404)
  if (nota.status === 'cancelada')  return json({ erro: 'nota já cancelada' }, 400)
  if (nota.status === 'cancelando') return json({ erro: 'cancelamento já em andamento' }, 409)
  if (!nota.numero_nfse)        return json({ erro: 'nota sem número NFS-e — não pode ser cancelada' }, 400)

  let codigoCancelamento = '2'
  try { const body = await request.json(); codigoCancelamento = body.codigo ?? '2' }
  catch (e) { console.error('cancelar: body inválido (usando código default):', e) }

  const producao = nota.origem !== 'manual-homologacao' && nota.origem !== 'hotmart-homologacao' && nota.origem !== 'homologacao'

  // P0-09: status intermediário antes de chamar WebIss
  await atualizarStatusNota(env, id, 'cancelando')

  let driveLink = nota.drive_link

  try {
    const issuer = emissor(env)
    const xmlCancel   = buildCancelamentoXml({ numeroNfse: nota.numero_nfse, cnpjPrestador: issuer.cnpj, imPrestador: issuer.im, codigoCancelamento, municipalityCode: issuer.municipalityCode })
    const xmlAssinado = await signXml(xmlCancel, env.CERT_PRIVATE_KEY, env.CERT_PUBLIC)
    await cancelarNfse(buildCabecalho(), xmlAssinado, producao, env)

    // WebIss confirmou — mover arquivo no Drive (best-effort)
    let driveError = null
    if (nota.drive_file_id && env.GOOGLE_PRIVATE_KEY) {
      try {
        const produto = await buscarProduto(env, nota.product_id ?? '') ?? { product_id: nota.product_id ?? 'sem-produto', nome: nota.nome_produto ?? 'Sem Produto', percentual: emissor(env).defaultPercent }
        const result  = await moverNotaParaCanceladas({ env, fileId: nota.drive_file_id, produto, dataEmissao: nota.criado_em })
        driveLink = result.webViewLink ?? driveLink
      } catch (err) {
        console.error('Drive move error:', err.message)
        driveError = err.message
      }
    } else if (!nota.drive_file_id && env.GOOGLE_PRIVATE_KEY) {
      driveError = 'nota sem drive_file_id (upload original falhou)'
    }

    // P1-08: se Drive falhou, sinalizar drive-pending para retry posterior
    const finalStatus = driveError ? 'cancelada-drive-pending' : 'cancelada'
    await atualizarStatusNota(env, id, finalStatus, driveLink)

    let emailRes = null
    if (await emailAtivo(env)) {
      emailRes = await enviarEmailNota(env, { tipo: 'cancelada', nomeTomador: nota.nome_tomador, emailTomador: nota.email_tomador, numeroNfse: nota.numero_nfse, driveLink, valorServicos: nota.valor, docTomador: nota.doc_tomador })
      if (!emailRes.ok) console.error('email_falha_cancelamento', JSON.stringify(emailRes))
    }

    return json({
      ok: true,
      driveLink,
      ...(driveError ? { driveError, status: finalStatus } : {}),
      ...(emailRes && !emailRes.ok ? { emailError: emailRes.body } : {}),
    })
  } catch (err) {
    // P0-09: rollback de status em caso de falha no WebIss
    await atualizarStatusNota(env, id, 'emitida')
    return json({ erro: err.message }, 500)
  }
}

// ─── Drive retry ────────────────────────────────────────────────────────────

async function handleDriveRetry(request, env) {
  const id   = new URL(request.url).pathname.split('/')[3]
  const nota = await buscarNotaPorId(env, id)
  if (!nota)               return json({ erro: 'nota não encontrada' }, 404)
  if (!nota.xml_completo)  return json({ erro: 'nota sem xml_completo' }, 400)
  if (nota.drive_file_id)  return json({ erro: 'nota já tem drive_file_id', driveLink: nota.drive_link }, 400)

  const produto = await buscarProduto(env, nota.product_id ?? '') ?? { product_id: nota.product_id ?? 'sem-produto', nome: nota.nome_produto ?? 'Sem Produto', percentual: emissor(env).defaultPercent }
  const status  = nota.status === 'cancelada' || nota.status === 'cancelada-drive-pending' ? 'cancelada' : 'emitida'

  const dados = { docTomador: nota.doc_tomador, nomeTomador: nota.nome_tomador, emailTomador: nota.email_tomador, valorServicos: nota.valor }
  const r = await uploadDrive(env, nota.xml_completo, dados, produto, status, { numero_nfse: nota.numero_nfse, valor: nota.valor, criado_em: nota.criado_em })
  if (r.error || !r.fileId) return json({ erro: 'upload falhou', driveError: r.error ?? 'sem fileId' }, 500)

  await atualizarDriveNota(env, { numeroNfse: nota.numero_nfse, fileId: r.fileId, webViewLink: r.webViewLink })
  return json({ ok: true, fileId: r.fileId, driveLink: r.webViewLink })
}

// ─── Regerar PDF + reupload no Drive (substitui arquivo existente) ────────────

async function handleRegerarPdfDrive(request, env) {
  const id   = new URL(request.url).pathname.split('/')[3]
  const nota = await buscarNotaPorId(env, id)
  if (!nota)              return json({ erro: 'nota não encontrada' }, 404)
  if (!nota.xml_completo) return json({ erro: 'nota sem xml_completo' }, 400)

  const produto = await buscarProduto(env, nota.product_id ?? '') ?? { product_id: nota.product_id ?? 'sem-produto', nome: nota.nome_produto ?? 'Sem Produto', percentual: emissor(env).defaultPercent }
  const status  = nota.status === 'cancelada' || nota.status === 'cancelada-drive-pending' ? 'cancelada' : 'emitida'

  // Sem pre-delete: uploadNotaToDrive cuida de dedupe atualizando in-place o
  // mais antigo e apagando os demais. Pre-deletar ANTES do PATCH na lógica
  // idempotente cria race com a list (eventual consistency do Drive) e aborta
  // a deduplicação.
  const dados = { docTomador: nota.doc_tomador, nomeTomador: nota.nome_tomador, emailTomador: nota.email_tomador, valorServicos: nota.valor }
  const r     = await uploadDrive(env, nota.xml_completo, dados, produto, status, { numero_nfse: nota.numero_nfse, valor: nota.valor, criado_em: nota.criado_em })
  if (r.error || !r.fileId) return json({ erro: 'upload falhou', driveError: r.error ?? 'sem fileId' }, 500)

  await atualizarDriveNota(env, { numeroNfse: nota.numero_nfse, fileId: r.fileId, webViewLink: r.webViewLink })
  return json({ ok: true, fileId: r.fileId, driveLink: r.webViewLink, dedup: r.dedup ?? 0 })
}

// ─── Atualizar produto de uma nota (corrige product_id e move arquivo no Drive) ──

async function handleAtualizarProduto(request, env) {
  const id   = new URL(request.url).pathname.split('/')[3]
  const nota = await buscarNotaPorId(env, id)
  if (!nota) return json({ erro: 'nota não encontrada' }, 404)

  let body
  try { body = await request.json() } catch { return json({ erro: 'payload inválido' }, 400) }
  if (!body.product_id) return json({ erro: 'campo obrigatório: product_id' }, 400)

  const produto = await buscarProduto(env, String(body.product_id))
  if (!produto) return json({ erro: `produto ${body.product_id} não cadastrado` }, 400)

  await env.DB.prepare(
    'UPDATE notas SET product_id=?, nome_produto=? WHERE id=?'
  ).bind(produto.product_id, produto.nome, id).run()

  // Regera PDF com nome novo do produto e reposiciona na pasta correta no Drive.
  let driveLink  = nota.drive_link
  let driveError = null
  if (env.GOOGLE_PRIVATE_KEY && nota.xml_completo) {
    const status = nota.status === 'cancelada' || nota.status === 'cancelada-drive-pending' ? 'cancelada' : 'emitida'
    // Sem pre-delete: uploadNotaToDrive já é idempotente (in-place update + dedupe).
    const dados = { docTomador: nota.doc_tomador, nomeTomador: nota.nome_tomador, emailTomador: nota.email_tomador, valorServicos: nota.valor }
    const r     = await uploadDrive(env, nota.xml_completo, dados, produto, status, { numero_nfse: nota.numero_nfse, valor: nota.valor, criado_em: nota.criado_em })
    if (r.error || !r.fileId) {
      driveError = r.error ?? 'sem fileId'
    } else {
      driveLink = r.webViewLink ?? null
      await atualizarDriveNota(env, { numeroNfse: nota.numero_nfse, fileId: r.fileId, webViewLink: driveLink })
    }
  }

  return json({ ok: true, product_id: produto.product_id, nome: produto.nome, driveLink, ...(driveError ? { driveError } : {}) })
}

// ─── Admin: listar todos os PDFs no Shared Drive (diagnóstico de duplicatas) ──

async function handleDriveListPdfs(request, env) {
  const { listarTodosPdfs } = await import('./drive.js')
  try {
    const files = await listarTodosPdfs({ env })
    return json({ total: files.length, files })
  } catch (e) {
    return json({ erro: e.message }, 500)
  }
}

// ─── XML de nota ─────────────────────────────────────────────────────────────

async function handleNotaXml(request, env) {
  const id   = new URL(request.url).pathname.split('/')[3]
  const nota = await buscarNotaPorId(env, id)
  if (!nota) return json({ erro: 'não encontrado' }, 404)

  return new Response(nota.xml_completo ?? '', {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}

// ─── Produtos API ─────────────────────────────────────────────────────────────

async function handleProdutosApi(request, env) {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-api-key',
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM produtos ORDER BY nome').all()
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json', ...cors } })
  }

  if (request.method === 'POST') {
    const { product_id, nome, percentual } = await request.json()
    if (!product_id || !nome || percentual == null) return json({ erro: 'campos obrigatórios' }, 400)
    await env.DB.prepare(
      'INSERT INTO produtos (product_id, nome, percentual) VALUES (?,?,?) ON CONFLICT(product_id) DO UPDATE SET nome=excluded.nome, percentual=excluded.percentual'
    ).bind(product_id, nome, Number(percentual)).run()
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } })
  }

  if (request.method === 'DELETE') {
    const product_id = new URL(request.url).searchParams.get('product_id')
    if (!product_id) return json({ erro: 'product_id obrigatório' }, 400)
    await env.DB.prepare('DELETE FROM produtos WHERE product_id=?').bind(product_id).run()
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...cors } })
  }

  return json({ erro: 'método não suportado' }, 405)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function emitir(dados, env, producao) {
  const xml         = buildRpsXml(dados)
  const xmlAssinado = await signXml(xml, env.CERT_PRIVATE_KEY, env.CERT_PUBLIC)
  return enviarNfse(buildCabecalho(), xmlAssinado, producao, env)
}

async function uploadDrive(env, xmlContent, dados, produto, status, notaParcial) {
  if (!env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_DRIVE_ROOT_FOLDER) return { error: 'drive_não_configurado' }
  try {
    const doc      = dados.docTomador ?? ''
    const fileName = `${dados.nomeTomador} - ${doc} - ${produto.nome} - ${produto.product_id}`
    const nota     = {
      nome_tomador:  dados.nomeTomador,
      doc_tomador:   doc,
      email_tomador: dados.emailTomador ?? '',
      valor:         dados.valorServicos ?? notaParcial?.valor,
      numero_nfse:   notaParcial?.numero_nfse,
      criado_em:     notaParcial?.criado_em ?? new Date().toISOString(),
      status,
    }
    const pdfBytes = await gerarDanfsePdf({ xml: xmlContent, nota, produto, env })
    const r        = await uploadNotaToDrive({ env, pdfBytes, fileName, produto, status, dataEmissao: nota.criado_em })
    return r
  } catch (err) {
    console.error('Drive upload error:', err.message)
    return { error: err.message }
  }
}

async function handleToggleEmail(request, env) {
  const { ativo } = await request.json()
  await env.DB.prepare(
    "INSERT INTO config (chave, valor) VALUES ('email_cliente_ativo', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  ).bind(ativo ? 'true' : 'false').run()
  return json({ ok: true, email_cliente_ativo: ativo })
}

function gerarNumeroRps() { return Date.now() }
function limparDoc(doc)   { return doc.replace(/\D/g, '') }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

// ─── Observabilidade: alerta automático via Resend ──────────────────────────

// Throttle: ≥3 falhas na hora atual e nenhum alerta já enviado nessa mesma hora.
// contextoFalha: { resultado, mensagem, transactionId? }
async function maybeAlertOps(env, contextoFalha = {}) {
  try {
    const { total, ultima_msg, ultima_tx } = await countAuthFailsLastHour(env)
    if (total < 3) return
    if (await alertaEnviadoNestaHora(env)) return

    // Marca PRIMEIRO pra evitar race em alta concorrência (mesmo que email falhe, não spammeia)
    await salvarAlertaEnviado(env, `total=${total} ultima=${(ultima_msg ?? contextoFalha.mensagem ?? '').slice(0, 200)}`)
    const r = await enviarAlertaOps(env, {
      contagem: total,
      ultimaMsg: ultima_msg ?? contextoFalha.mensagem ?? '(sem mensagem)',
      transactionId: ultima_tx ?? contextoFalha.transactionId ?? null,
    })
    if (!r.ok) console.error('enviarAlertaOps falhou:', r.status, r.body)
  } catch (e) {
    console.error('maybeAlertOps erro:', e)
  }
}

// ─── Endpoint: /api/webhook-log (admin, x-api-key) ──────────────────────────

async function handleWebhookLogApi(request, env) {
  const url = new URL(request.url)
  const filters = {
    resultado: url.searchParams.get('resultado') ?? undefined,
    since:     url.searchParams.get('since')     ?? undefined,
    limit:     url.searchParams.get('limit')     ?? undefined,
  }
  const results = await listarWebhookLog(env, filters)
  return json({ total: results.length, filters, results })
}

// ─── Endpoint: /api/health (público, sem secrets vazados) ───────────────────

async function handleHealth(request, env) {
  const SECRETS_CRITICOS = [
    'HOTMART_TOKEN', 'API_KEY', 'CERT_PRIVATE_KEY', 'CERT_PUBLIC',
    'RESEND_API_KEY', 'EMAIL_REMETENTE',
    'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_ROOT_FOLDER',
    'COOKIE_HMAC_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD',
  ]
  const secrets_present = {}
  for (const k of SECRETS_CRITICOS) {
    const v = env[k]
    secrets_present[k] = typeof v === 'string' ? v.length > 0 : !!v
  }

  const [db_ok, last_emission, failed_1h, failed_24h] = await Promise.all([
    dbReachable(env),
    ultimaEmissaoAutomatica(env),
    countAuthFailsWindow(env, 1),
    countAuthFailsWindow(env, 24),
  ])

  const certInfo = parseCertNotAfter(env.CERT_PUBLIC)

  const ok = db_ok
    && secrets_present.HOTMART_TOKEN
    && secrets_present.API_KEY
    && secrets_present.CERT_PRIVATE_KEY
    && secrets_present.CERT_PUBLIC

  return json({
    ok,
    environment: env.ENVIRONMENT ?? null,
    secrets_present,
    db_reachable: db_ok,
    cert_expires_at: certInfo.expiresAt,
    cert_days_remaining: certInfo.daysRemaining,
    last_automatic_emission: last_emission,
    failed_webhooks_last_hour: failed_1h,
    failed_webhooks_last_24h: failed_24h,
    now: new Date().toISOString(),
  })
}

// Parse leve do X.509 do PEM. Encontra o segundo INTEGER do bloco Validity (notAfter).
// Não substitui uma lib X.509 completa — mas evita pull de dep pesada no Worker.
// Retorna { expiresAt: ISO|null, daysRemaining: number|null }.
function parseCertNotAfter(certPem) {
  try {
    if (!certPem || typeof certPem !== 'string') return { expiresAt: null, daysRemaining: null }
    const m = certPem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/)
    if (!m) return { expiresAt: null, daysRemaining: null }
    const b64 = m[1].replace(/\s+/g, '')
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    // Varre por sequências UTCTime (0x17) ou GeneralizedTime (0x18).
    // ICP-Brasil usa UTCTime (YYMMDDHHMMSSZ, len=13) ou GeneralizedTime (YYYYMMDDHHMMSSZ, len=15).
    // Validity = SEQUENCE { notBefore, notAfter } — pegamos o SEGUNDO time encontrado.
    const dates = []
    for (let i = 0; i < bytes.length - 2 && dates.length < 4; i++) {
      const tag = bytes[i]
      if (tag !== 0x17 && tag !== 0x18) continue
      const len = bytes[i + 1]
      if (len !== 13 && len !== 15) continue
      const raw = String.fromCharCode(...bytes.slice(i + 2, i + 2 + len))
      if (!/^\d+Z$/.test(raw)) continue
      const iso = utcOrGenToIso(raw, tag)
      if (iso) dates.push(iso)
    }
    const notAfter = dates[1] ?? null
    if (!notAfter) return { expiresAt: null, daysRemaining: null }
    const days = Math.floor((new Date(notAfter).getTime() - Date.now()) / (24 * 3600 * 1000))
    return { expiresAt: notAfter, daysRemaining: days }
  } catch (e) {
    console.error('parseCertNotAfter erro:', e)
    return { expiresAt: null, daysRemaining: null }
  }
}

function utcOrGenToIso(raw, tag) {
  // tag 0x17 = UTCTime YYMMDDHHMMSSZ; 0x18 = GeneralizedTime YYYYMMDDHHMMSSZ
  try {
    if (tag === 0x17) {
      const yy = parseInt(raw.slice(0, 2), 10)
      const year = yy >= 50 ? 1900 + yy : 2000 + yy
      const mm = raw.slice(2, 4), dd = raw.slice(4, 6)
      const hh = raw.slice(6, 8), mi = raw.slice(8, 10), ss = raw.slice(10, 12)
      return `${year}-${mm}-${dd}T${hh}:${mi}:${ss}Z`
    }
    if (tag === 0x18) {
      const year = raw.slice(0, 4)
      const mm = raw.slice(4, 6), dd = raw.slice(6, 8)
      const hh = raw.slice(8, 10), mi = raw.slice(10, 12), ss = raw.slice(12, 14)
      return `${year}-${mm}-${dd}T${hh}:${mi}:${ss}Z`
    }
  } catch { /* ignore */ }
  return null
}
