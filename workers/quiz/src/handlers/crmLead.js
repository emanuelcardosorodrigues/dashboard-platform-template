// POST /q/api/crm-lead — encaminha o lead do formulário para o CRM configurado.
//
// POR QUE ESTE ENDPOINT EXISTE (e não o webhook por slug do /q/api/lead):
// o webhook do `lead.js` só dispara quando a sessão existe E o filtro de bot
// deixa passar. Só que o público desta ficha chega pelo link que o ManyChat
// manda no WhatsApp, e o navegador embutido do WhatsApp/Instagram é justamente
// o que mais cai no blocklist (UA reduzida "Android 10; K", FBAV). Nesses casos
// o /start devolve session_id:null, a página cai na rede de segurança que grava
// direto no Supabase — e o CRM nunca ficaria sabendo. Aqui o caminho é único:
// a ficha chama SEMPRE este endpoint, com sessão ou sem.
//
// O token do CRM fica no Worker (secret), nunca no HTML.
// Falha → DLQ com table_name `webhook:crm` → o cron */5 reenvia (até 3x).

import { jsonResponse, errorResponse, readJson } from '../lib/http.js';

const CAMPOS_QUALIFICACAO = ['cadeiras', 'faturamento', 'parceiro', 'investimento', 'desafio'];

function limpar(v, max = 500) {
  return v == null ? null : String(v).slice(0, max);
}

// O deepFind do CRM procura chaves por nome. Os nomes abaixo são escolhidos pra
// casar com as listas dele: `nome`→contact_name, `whatsapp`→phone, `email`→email,
// `id`→chave de dedupe, `event`→event_type. NÃO incluir chave chamada `token`
// nem `status`: o deepFind as trataria como id do evento / tipo do evento.
function montarPayload(lead, extra) {
  const digitos = String(lead.whatsapp || lead.phone || '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  const e164 = digitos.startsWith('55') ? `+${digitos}` : `+55${digitos}`;

  const qualificacao = {};
  for (const k of CAMPOS_QUALIFICACAO) {
    if (lead[k] != null && String(lead[k]).trim() !== '') qualificacao[k] = limpar(lead[k]);
  }

  return {
    event: 'formulario_interesse',
    // dedupe por pessoa: reentrega do mesmo lead em 24h não duplica evento.
    // O contato em si já é upsert por (workspace_id, phone), então é seguro.
    id: `formulario-${digitos}`,
    origem: 'Formulário de Interesse',
    nome: limpar(lead.name) || null,
    email: limpar(lead.email) || null,
    whatsapp: e164,
    qualificacao,
    quiz_slug: limpar(extra.quiz_slug, 80),
    caminho: limpar(extra.caminho, 20),      // 'sessao' ou 'fallback'
    utms: extra.utms && typeof extra.utms === 'object' ? extra.utms : {},
    capturado_em: new Date().toISOString(),
  };
}

// O payload vai pra DLQ SEM a URL: o token do CRM está nela, e o D1 não é lugar
// de guardar segredo. O `retryRow` do cron remonta a URL a partir do env.
async function paraDLQ(env, payload, err) {
  try {
    await env.QUIZ_DB.prepare(
      'INSERT INTO dlq (table_name, payload, err, created_at) VALUES (?,?,?,?)'
    ).bind('webhook:crm', JSON.stringify(payload), String(err).slice(0, 500), Date.now()).run();
  } catch (_) { /* DLQ indisponível não pode derrubar a resposta */ }
}

export async function handleCrmLead(request, env, ctx) {
  let body;
  try { body = await readJson(request); }
  catch (e) { return errorResponse(String(e.message || e), 400); }

  const quiz_slug = String(body.quiz_slug || '').trim();
  if (!/^[a-z0-9-]{1,80}$/i.test(quiz_slug)) return errorResponse('invalid_quiz_slug', 400);

  const payload = montarPayload(body.lead || {}, {
    quiz_slug,
    caminho: body.caminho,
    utms: body.utms,
  });
  // Sem telefone utilizável não há o que contatar depois — que é o ponto de mandar
  // pro CRM. Responde 200 assim mesmo pra não travar o redirect da ficha.
  if (!payload) return jsonResponse({ ok: true, skipped: 'sem_telefone' });

  const base = env.CRM_WEBHOOK_URL;
  const token = env.CRM_WEBHOOK_TOKEN;
  if (!base || !token) {
    await paraDLQ(env, payload, 'crm_nao_configurado');
    return jsonResponse({ ok: true, queued: true });
  }
  const url = `${base}?token=${encodeURIComponent(token)}`;

  // waitUntil: a resposta volta na hora e o POST sobrevive ao redirect da ficha.
  ctx.waitUntil((async () => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) await paraDLQ(env, payload, `crm_${r.status}`);
    } catch (e) {
      await paraDLQ(env, payload, e);
    }
  })());

  return jsonResponse({ ok: true });
}
