import { countAuthFailsWindow, listarWebhookLog } from './db.js';

const COOKIE = 'nfse_session';
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8h

// ─── HMAC-SHA256 cookie helpers ───────────────────────────────────────────────

async function importHmacKey(secret) {
  const raw = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signCookie(payload, secret) {
  const key  = await importHmacKey(secret);
  const data = JSON.stringify(payload);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return btoa(data) + '.' + sigB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function verifyCookie(token, secret) {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const dataB64 = token.slice(0, dot);
  const sigB64  = token.slice(dot + 1).replace(/-/g, '+').replace(/_/g, '/');
  try {
    const key      = await importHmacKey(secret);
    const data     = atob(dataB64);
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid    = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function handleAdmin(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/admin/login') {
    if (request.method === 'GET')  return loginPage();
    if (request.method === 'POST') return processLogin(request, env);
  }

  if (url.pathname === '/admin/logout') {
    return logout();
  }

  if (!await autenticado(request, env)) {
    return Response.redirect(new URL('/admin/login', request.url).toString(), 302);
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return paginaNotas(request, env);
  }

  if (url.pathname === '/admin/webhook-log') {
    return paginaWebhookLog(request, env);
  }

  if (url.pathname === '/admin/produtos') {
    if (request.method === 'GET')    return paginaProdutos(request, env);
    if (request.method === 'POST')   return salvarProduto(request, env);
    if (request.method === 'DELETE') return deletarProduto(request, env);
  }

  if (url.pathname === '/admin/config/email' && request.method === 'POST') {
    return toggleEmailAdmin(request, env);
  }

  return new Response('Não encontrado', { status: 404 });
}

async function autenticado(request, env) {
  if (!env.COOKIE_HMAC_SECRET) return false;
  const cookie = request.headers.get('Cookie') ?? '';
  const match  = cookie.match(new RegExp(`${COOKIE}=([^;\\s]+)`));
  if (!match) return false;
  const payload = await verifyCookie(match[1], env.COOKIE_HMAC_SECRET);
  return payload !== null && payload.exp > Date.now() && payload.user === env.ADMIN_USER;
}

async function processLogin(request, env) {
  const form = await request.formData();
  const user = form.get('user');
  const pass = form.get('pass');

  if (user !== env.ADMIN_USER || pass !== env.ADMIN_PASSWORD) {
    return loginPage('Usuário ou senha incorretos.');
  }

  if (!env.COOKIE_HMAC_SECRET) {
    return new Response('Servidor mal configurado (COOKIE_HMAC_SECRET ausente)', { status: 500 });
  }

  const token   = await signCookie({ user, exp: Date.now() + SESSION_TTL }, env.COOKIE_HMAC_SECRET);
  const headers = new Headers({ Location: '/admin' });
  headers.append('Set-Cookie', `${COOKIE}=${token}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  return new Response(null, { status: 302, headers });
}

function logout() {
  const headers = new Headers({ Location: '/admin/login' });
  headers.append('Set-Cookie', `${COOKIE}=; Path=/admin; Max-Age=0`);
  return new Response(null, { status: 302, headers });
}

function fmtValor(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
function fmtDoc(doc) {
  const d = String(doc ?? '').replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc ?? '—'
}
function fmtData(s) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

async function paginaNotas(request, env) {
  const [{ results }, falhas24h] = await Promise.all([
    env.DB.prepare(
      `SELECT id, numero_nfse, nome_tomador, doc_tomador, email_tomador, valor,
              nome_produto, origem, status, criado_em, drive_link
       FROM notas ORDER BY criado_em DESC LIMIT 200`
    ).all(),
    countAuthFailsWindow(env, 24),
  ])

  const healthCard = renderHealthCard(falhas24h)

  const linhas = results.map(n => `
    <tr class="${n.status === 'cancelada' ? 'cancelada' : ''}">
      <td>${esc(n.numero_nfse ?? '—')}</td>
      <td>${esc(n.nome_tomador)}</td>
      <td>${esc(fmtDoc(n.doc_tomador))}</td>
      <td>${esc(n.email_tomador ?? '—')}</td>
      <td>${esc(fmtValor(n.valor))}</td>
      <td>${esc(n.nome_produto ?? '—')}</td>
      <td>${esc(n.origem ?? '—')}</td>
      <td><span class="badge ${n.status === 'cancelada' ? 'badge-cancel' : 'badge-ok'}">${esc(n.status ?? 'emitida')}</span></td>
      <td>${esc(fmtData(n.criado_em))}</td>
      <td>
        ${n.drive_link ? `<a href="${esc(n.drive_link)}" target="_blank">XML</a>` : '—'}
      </td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NFS-e — Notas</title>
  <style>
    body { font-family: sans-serif; max-width: 1100px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.4rem; }
    nav { margin-bottom: 16px; display: flex; gap: 16px; }
    nav a { color: #1a73e8; text-decoration: none; font-size: .95rem; }
    nav a.active { font-weight: bold; border-bottom: 2px solid #1a73e8; }
    table { width: 100%; border-collapse: collapse; font-size: .88rem; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eee; white-space: nowrap; }
    th { background: #f4f4f4; position: sticky; top: 0; }
    tr.cancelada td { opacity: .55; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: .8rem; }
    .badge-ok { background: #e6f4ea; color: #1e8e3e; }
    .badge-cancel { background: #fce8e6; color: #c5221f; }
    .logout { float: right; font-size: .85rem; }
    .health-card { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 8px; margin: 12px 0 20px; border: 1px solid; }
    .health-card .dot { font-size: 1.3rem; line-height: 1; }
    .health-card .label { flex: 1; font-size: .92rem; }
    .health-card .label small { display: block; color: inherit; opacity: .75; font-size: .8rem; margin-top: 2px; }
    .health-card a { color: inherit; text-decoration: underline; font-size: .88rem; }
    .health-ok    { background: #e6f4ea; color: #1e8e3e; border-color: #c4e7cf; }
    .health-warn  { background: #fef7e0; color: #b06000; border-color: #f6deaa; }
    .health-crit  { background: #fce8e6; color: #c5221f; border-color: #f4c4c0; }
  </style>
</head>
<body>
  <a class="logout" href="/admin/logout">Sair</a>
  <h1>NFS-e</h1>
  <nav>
    <a href="/admin" class="active">Notas</a>
    <a href="/admin/produtos">Notas automáticas</a>
    <a href="/admin/webhook-log">Webhook log</a>
  </nav>
  ${healthCard}
  <p style="color:#666;font-size:.85rem">${results.length} nota(s)</p>
  <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Nº NFS-e</th><th>Tomador</th><th>Documento</th><th>Email</th>
        <th>Valor</th><th>Produto</th><th>Origem</th><th>Status</th><th>Emissão</th><th>XML</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="10" style="text-align:center;padding:32px;color:#999">Nenhuma nota emitida ainda</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

async function paginaProdutos(request, env) {
  const { results }  = await env.DB.prepare('SELECT * FROM produtos ORDER BY nome').all()
  const configEmail  = await env.DB.prepare("SELECT valor FROM config WHERE chave='email_cliente_ativo'").first()
  const emailAtivo   = configEmail?.valor === 'true'

  const toggleHtml = `
    <section style="margin-top:32px;padding:20px;border:1px solid #ddd;border-radius:8px;max-width:420px">
      <h2 style="margin:0 0 12px;font-size:1.1rem">Envio de email ao cliente</h2>
      <label style="display:flex;align-items:center;gap:12px;cursor:pointer">
        <input type="checkbox" id="emailToggle" ${emailAtivo ? 'checked' : ''} onchange="toggleEmail(this.checked)"
               style="width:18px;height:18px;cursor:pointer">
        <span id="emailStatus">${emailAtivo ? 'Ativado — cliente recebe email ao emitir/cancelar' : 'Desativado'}</span>
      </label>
    </section>`

  const linhas = results.map(p => `
    <tr>
      <td>${esc(p.nome)}</td>
      <td>${esc(p.product_id)}</td>
      <td>${p.percentual}%</td>
      <td>
        <button onclick="editar('${esc(p.product_id)}','${esc(p.nome)}','${p.percentual}')">Editar</button>
        <button onclick="deletar('${esc(p.product_id)}')">Remover</button>
      </td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NFS-e — Notas automáticas</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.4rem; }
    nav { margin-bottom: 16px; display: flex; gap: 16px; }
    nav a { color: #1a73e8; text-decoration: none; font-size: .95rem; }
    nav a.active { font-weight: bold; border-bottom: 2px solid #1a73e8; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #ddd; }
    th { background: #f4f4f4; }
    form { display: grid; gap: 8px; max-width: 420px; margin-top: 32px; }
    input { padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    button { padding: 8px 16px; cursor: pointer; }
    .primary { background: #1a73e8; color: #fff; border: none; border-radius: 4px; }
    .danger { background: #d93025; color: #fff; border: none; border-radius: 4px; }
    .logout { float: right; font-size: 0.85rem; }
  </style>
</head>
<body>
  <a class="logout" href="/admin/logout">Sair</a>
  <h1>NFS-e</h1>
  <nav>
    <a href="/admin">Notas</a>
    <a href="/admin/produtos" class="active">Notas automáticas</a>
  </nav>
  <h2 style="font-size:1.1rem;margin-top:0">Notas automáticas</h2>
  <p style="color:#666;font-size:.85rem;margin-top:-8px">Compras via Hotmart só emitem NFS-e automaticamente se o produto estiver cadastrado aqui.</p>

  <table>
    <thead><tr><th>Produto</th><th>product_id</th><th>%</th><th>Ações</th></tr></thead>
    <tbody id="linhas">${linhas}</tbody>
  </table>

  ${toggleHtml}

  <h2 id="form-titulo" style="margin-top:32px;font-size:1.1rem">Adicionar nota automática</h2>
  <form id="form" onsubmit="salvar(event)">
    <input id="product_id" name="product_id" placeholder="product_id (da Hotmart)" required>
    <input id="nome"  name="nome"  placeholder="Nome do produto" required>
    <input id="perc"  name="percentual" type="number" min="1" max="100" step="0.01" placeholder="Percentual (ex: 25)" required>
    <button type="submit" class="primary">Salvar</button>
  </form>

  <script>
    async function salvar(e) {
      e.preventDefault();
      const body = new FormData(e.target);
      const res  = await fetch('/admin/produtos', { method: 'POST', body });
      if (res.ok) location.reload(); else alert('Erro ao salvar');
    }
    function editar(product_id, nome, perc) {
      document.getElementById('product_id').value = product_id;
      document.getElementById('nome').value  = nome;
      document.getElementById('perc').value  = perc;
      document.getElementById('form-titulo').textContent = 'Editar nota automática';
      document.getElementById('product_id').readOnly = true;
    }
    async function deletar(product_id) {
      if (!confirm('Remover produto?')) return;
      const res = await fetch('/admin/produtos?product_id=' + encodeURIComponent(product_id), { method: 'DELETE' });
      if (res.ok) location.reload(); else alert('Erro ao remover');
    }
    async function toggleEmail(ativo) {
      const res = await fetch('/admin/config/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo }),
      });
      if (res.ok) {
        document.getElementById('emailStatus').textContent = ativo
          ? 'Ativado — cliente recebe email ao emitir/cancelar'
          : 'Desativado';
      } else {
        alert('Erro ao alterar configuração');
        document.getElementById('emailToggle').checked = !ativo;
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function salvarProduto(request, env) {
  const form       = await request.formData();
  const product_id      = form.get('product_id')?.trim();
  const nome       = form.get('nome')?.trim();
  const percentual = parseFloat(form.get('percentual'));

  if (!product_id || !nome || isNaN(percentual)) return new Response('Dados inválidos', { status: 400 });

  await env.DB.prepare(
    'INSERT INTO produtos (product_id, nome, percentual) VALUES (?,?,?) ON CONFLICT(product_id) DO UPDATE SET nome=excluded.nome, percentual=excluded.percentual'
  ).bind(product_id, nome, percentual).run();

  return new Response('ok');
}

async function toggleEmailAdmin(request, env) {
  const { ativo } = await request.json()
  await env.DB.prepare(
    "INSERT INTO config (chave, valor) VALUES ('email_cliente_ativo', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor"
  ).bind(ativo ? 'true' : 'false').run()
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
}

async function deletarProduto(request, env) {
  const product_id = new URL(request.url).searchParams.get('product_id');
  if (!product_id) return new Response('product_id obrigatório', { status: 400 });
  await env.DB.prepare('DELETE FROM produtos WHERE product_id=?').bind(product_id).run();
  return new Response('ok');
}

function loginPage(erro = '') {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Login — NFS-e</title>
  <style>
    body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f4f4f4; }
    form { background: #fff; padding: 32px; border-radius: 8px; display: grid; gap: 12px; min-width: 300px; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
    h2 { margin: 0; font-size: 1.2rem; }
    input { padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    button { padding: 10px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    .erro { color: #d93025; font-size: .9rem; }
  </style>
</head>
<body>
  <form method="POST" action="/admin/login">
    <h2>NFS-e Admin</h2>
    ${erro ? `<p class="erro">${erro}</p>` : ''}
    <input name="user" type="email" placeholder="E-mail" required autofocus>
    <input name="pass" type="password" placeholder="Senha" required>
    <button type="submit">Entrar</button>
  </form>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function renderHealthCard(falhas24h) {
  const n = Number(falhas24h) || 0;
  let cls, dot, texto;
  if (n === 0) {
    cls = 'health-ok';
    dot = '🟢';
    texto = 'Nenhuma falha nas últimas 24h';
  } else if (n <= 5) {
    cls = 'health-warn';
    dot = '🟡';
    texto = `${n} falha(s) nas últimas 24h`;
  } else {
    cls = 'health-crit';
    dot = '🔴';
    texto = `${n} falhas nas últimas 24h — investigar`;
  }
  return `
    <div class="health-card ${cls}">
      <span class="dot">${dot}</span>
      <span class="label">
        ${texto}
        <small>Webhook Hotmart → NFS-e</small>
      </span>
      <a href="/admin/webhook-log">Ver logs</a>
    </div>`;
}

async function paginaWebhookLog(request, env) {
  const url = new URL(request.url);
  const resultado = url.searchParams.get('resultado') ?? '';
  const since = url.searchParams.get('since') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10) || 200, 1), 1000);

  const filtros = { since, limit };
  if (resultado) filtros.resultado = resultado;
  const results = await listarWebhookLog(env, filtros);

  const linhas = results.map(r => `
    <tr>
      <td>${esc(fmtData(r.criado_em))}</td>
      <td>${esc(r.evento ?? '—')}</td>
      <td><span class="badge ${badgeClass(r.resultado)}">${esc(r.resultado ?? '—')}</span></td>
      <td>${esc(r.transaction_id ?? '—')}</td>
      <td>${esc(r.product_id ?? '—')}</td>
      <td class="msg">${esc((r.mensagem ?? '').slice(0, 300))}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NFS-e — Webhook log</title>
  <style>
    body { font-family: sans-serif; max-width: 1200px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.4rem; }
    nav { margin-bottom: 16px; display: flex; gap: 16px; }
    nav a { color: #1a73e8; text-decoration: none; font-size: .95rem; }
    nav a.active { font-weight: bold; border-bottom: 2px solid #1a73e8; }
    form.filtros { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; align-items: end; }
    form.filtros label { font-size: .82rem; color: #555; display: flex; flex-direction: column; gap: 2px; }
    form.filtros input, form.filtros select { padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: .9rem; }
    form.filtros button { padding: 7px 14px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: .9rem; }
    table { width: 100%; border-collapse: collapse; font-size: .85rem; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
    th { background: #f4f4f4; position: sticky; top: 0; }
    td.msg { white-space: pre-wrap; word-break: break-word; max-width: 520px; font-family: ui-monospace, monospace; font-size: .78rem; color: #444; }
    .badge { padding: 2px 8px; border-radius: 12px; font-size: .78rem; }
    .badge-ok    { background: #e6f4ea; color: #1e8e3e; }
    .badge-warn  { background: #fef7e0; color: #b06000; }
    .badge-err   { background: #fce8e6; color: #c5221f; }
    .badge-neutro{ background: #eee; color: #555; }
    .logout { float: right; font-size: .85rem; }
  </style>
</head>
<body>
  <a class="logout" href="/admin/logout">Sair</a>
  <h1>NFS-e — Webhook log</h1>
  <nav>
    <a href="/admin">Notas</a>
    <a href="/admin/produtos">Notas automáticas</a>
    <a href="/admin/webhook-log" class="active">Webhook log</a>
  </nav>
  <form class="filtros" method="GET" action="/admin/webhook-log">
    <label>Resultado
      <select name="resultado">
        <option value="">— todos —</option>
        ${['emitida','auth_fail_hmac','auth_fail_hmac_missing','auth_fail_hottok','erro','config_missing','ignorada_evento','ignorada_duplicada','ignorada_duplicada_race','ignorada_produto','ignorada_cancel_sem_tx','ignorada_cancel_sem_nota','ignorada_cancel_duplicada','cancelada_via_webhook','erro_cancelamento_webhook','alerta_enviado']
          .map(r => `<option value="${esc(r)}"${r === resultado ? ' selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
    </label>
    <label>Desde (ISO)
      <input name="since" value="${esc(since)}" size="22">
    </label>
    <label>Limite
      <input name="limit" type="number" min="1" max="1000" value="${limit}">
    </label>
    <button type="submit">Filtrar</button>
  </form>
  <p style="color:#666;font-size:.85rem">${results.length} entrada(s)</p>
  <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Quando</th><th>Evento</th><th>Resultado</th><th>Transaction</th><th>Produto</th><th>Mensagem</th>
      </tr></thead>
      <tbody>${linhas || '<tr><td colspan="6" style="text-align:center;padding:32px;color:#999">Nenhuma entrada para esses filtros</td></tr>'}</tbody>
    </table>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function badgeClass(resultado) {
  if (resultado === 'emitida' || resultado === 'cancelada_via_webhook') return 'badge-ok';
  if (resultado === 'erro' || resultado === 'config_missing' || (resultado ?? '').startsWith('auth_fail')) return 'badge-err';
  if ((resultado ?? '').startsWith('ignorada')) return 'badge-neutro';
  if (resultado === 'alerta_enviado') return 'badge-warn';
  return 'badge-neutro';
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
