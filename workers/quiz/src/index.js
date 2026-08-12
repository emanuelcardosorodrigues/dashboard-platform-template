// dashboard-quiz — entrypoint Worker
// Rotas: seu-dominio.com/q/*

import { handleQuizPage } from './handlers/quizPage.js';
import { handleStart } from './handlers/start.js';
import { handleEvent } from './handlers/event.js';
import { handleLead } from './handlers/lead.js';
import { handleCrmLead } from './handlers/crmLead.js';
import { handleAdmin } from './handlers/admin.js';
import { drainDLQ } from './handlers/cron.js';
import { preflight, jsonResponse, errorResponse } from './lib/http.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    const pf = preflight(request);
    if (pf) return pf;

    // Health (no auth, no logging)
    if (path === '/q/health') {
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    // API endpoints
    if (path === '/q/api/start') {
      if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
      return handleStart(request, env, ctx);
    }
    if (path === '/q/api/event') {
      if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
      return handleEvent(request, env, ctx);
    }
    if (path === '/q/api/lead') {
      if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
      return handleLead(request, env, ctx);
    }
    if (path === '/q/api/crm-lead') {
      if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
      return handleCrmLead(request, env, ctx);
    }
    if (path.startsWith('/q/api/admin/')) {
      const subpath = path.slice('/q/api/admin/'.length);
      return handleAdmin(request, env, ctx, subpath);
    }

    // /q/{slug} ou /q/{slug}/
    const m = path.match(/^\/q\/([a-z0-9-]+)\/?$/i);
    if (m) {
      return handleQuizPage(request, env, ctx, m[1]);
    }

    // /q/ root → fallback do asset (SPA)
    if (path === '/q/' || path === '/q') {
      return env.ASSETS.fetch(request);
    }

    // Outros assets dentro de /q/* (CSS, JS, imagens)
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    console.log('[cron] tick', controller.cron, new Date().toISOString());
    try {
      const result = await drainDLQ(env, ctx);
      console.log('[cron] result', JSON.stringify(result));
    } catch (e) {
      console.error('[cron] failed', String(e));
    }
  },
};
