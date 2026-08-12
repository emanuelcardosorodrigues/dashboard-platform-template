const TOKEN_URL  = 'https://oauth2.googleapis.com/token'
const DRIVE_API  = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const SCOPE      = 'https://www.googleapis.com/auth/drive'

// Service accounts não têm storage próprio; uploads e listagens só funcionam em Shared
// Drive quando os params abaixo estão presentes em todas as requests.
const ALL_DRIVES_QS = 'supportsAllDrives=true&includeItemsFromAllDrives=true'

// Timeout padrão para fetch ao Drive (10s para token/metadados, 30s para upload).
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10000) {
  const ac = new AbortController()
  const t  = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

// ─── JWT / Auth ──────────────────────────────────────────────────────────────

function pemToBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf.buffer
}

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000)
  const enc  = new TextEncoder()

  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim  = b64url(enc.encode(JSON.stringify({
    iss: clientEmail, scope: SCOPE, aud: TOKEN_URL,
    iat: now, exp: now + 3600,
  })))

  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claim}`))
  const jwt = `${header}.${claim}.${b64url(sig)}`

  const res  = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  }, 10000)
  const data = await res.json()
  if (!data.access_token) throw new Error(`Drive auth: HTTP ${res.status} ${JSON.stringify(data)}`)
  return data.access_token
}

// ─── Folder helpers ──────────────────────────────────────────────────────────

async function findFolder(token, name, parentId) {
  const q   = `name=${JSON.stringify(name)} and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const res = await fetchWithTimeout(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&${ALL_DRIVES_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const data = await res.json()
  return data.files?.[0]?.id ?? null
}

async function createFolder(token, name, parentId) {
  const res = await fetchWithTimeout(`${DRIVE_API}/files?${ALL_DRIVES_QS}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  }, 10000)
  const data = await res.json()
  if (!data.id) throw new Error(`createFolder "${name}": HTTP ${res.status} ${JSON.stringify(data)}`)
  return data.id
}

async function ensureFolder(token, name, parentId, db) {
  const cacheKey = `${parentId}/${name}`
  if (db) {
    const cached = await db.prepare('SELECT folder_id FROM drive_folders WHERE path=?').bind(cacheKey).first()
    if (cached?.folder_id) return cached.folder_id
  }
  let id = await findFolder(token, name, parentId)
  if (!id) id = await createFolder(token, name, parentId)
  if (db) {
    await db.prepare(
      'INSERT OR REPLACE INTO drive_folders (path, folder_id, criado_em) VALUES (?,?,datetime("now"))'
    ).bind(cacheKey, id).run()
  }
  return id
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Faz upload do PDF da nota para a pasta correta no Drive.
 *
 * Estrutura:
 *   ROOT/
 *     [product_id] - [nome]/
 *       Notas Emitidas | Notas Canceladas/
 *         [nome] - MM/AA/
 *           [fileName].pdf
 *
 * Aceita pdfBytes (Uint8Array). O conteúdo é codificado em base64 para upload multipart.
 */
export async function uploadNotaToDrive({ env, pdfBytes, fileName, produto, status, dataEmissao }) {
  const token  = await getAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER

  const prodFolderName = `${produto.product_id} - ${produto.nome}`
  const prodFolderId   = await ensureFolder(token, prodFolderName, rootId, env.DB)
  const statusName     = status === 'cancelada' ? 'Notas Canceladas' : 'Notas Emitidas'
  const statusFolderId = await ensureFolder(token, statusName, prodFolderId, env.DB)
  const date   = dataEmissao ? new Date(dataEmissao) : new Date()
  const mm     = String(date.getMonth() + 1).padStart(2, '0')
  const aa     = String(date.getFullYear()).slice(2)
  const monthFolderId = await ensureFolder(token, `${produto.nome} - ${mm}/${aa}`, statusFolderId, env.DB)

  // Idempotência: lista todos os arquivos com mesmo nome na pasta-mês.
  // Se já existem, atualiza o mais antigo (mantém fileId/link estáveis) e
  // apaga os demais — elimina duplicatas mesmo que o D1 tenha drive_file_id desatualizado.
  const fullName = `${fileName}.pdf`
  const listQ   = `name='${fullName.replace(/'/g, "\\'")}' and '${monthFolderId}' in parents and trashed=false`
  const listRes = await fetchWithTimeout(
    `${DRIVE_API}/files?q=${encodeURIComponent(listQ)}&fields=files(id,createdTime)&pageSize=50&${ALL_DRIVES_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const listData  = await listRes.json()
  const existing  = (listData.files ?? []).slice().sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? ''))
  const keepId    = existing[0]?.id ?? null
  const dropIds   = existing.slice(1).map(f => f.id)

  const boundary = 'nfse_boundary_314159'
  const enc      = new TextEncoder()

  if (keepId) {
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: binary\r\n\r\n`
    )
    const tail = enc.encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + pdfBytes.length + tail.length)
    body.set(head, 0); body.set(pdfBytes, head.length); body.set(tail, head.length + pdfBytes.length)

    const res = await fetchWithTimeout(
      `${UPLOAD_API}/files/${keepId}?uploadType=multipart&fields=id,webViewLink&${ALL_DRIVES_QS}`,
      {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
        body,
      },
      30000,
    )
    const data = await res.json()
    if (!data.id) throw new Error(`Drive update: HTTP ${res.status} ${JSON.stringify(data)}`)

    // Move duplicatas para a lixeira do Shared Drive (PATCH trashed=true; Content
    // Manager não tem permissão para DELETE permanente, mas pode trashar).
    const dedupResults = []
    for (const did of dropIds) {
      try {
        const dr = await fetchWithTimeout(
          `${DRIVE_API}/files/${did}?${ALL_DRIVES_QS}`,
          {
            method:  'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ trashed: true }),
          },
          10000,
        )
        dedupResults.push({ id: did, status: dr.status, ok: dr.ok })
        if (!dr.ok) console.warn('drive trash duplicate falhou:', did, dr.status, await dr.text())
      } catch (e) { console.warn('drive trash duplicate exception:', did, e?.message); dedupResults.push({ id: did, error: e.message }) }
    }
    return { fileId: data.id, webViewLink: data.webViewLink, dedup: dropIds.length, dedupResults }
  }

  const meta = JSON.stringify({ name: fullName, parents: [monthFolderId] })
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: binary\r\n\r\n`
  )
  const tail = enc.encode(`\r\n--${boundary}--`)
  const body = new Uint8Array(head.length + pdfBytes.length + tail.length)
  body.set(head, 0); body.set(pdfBytes, head.length); body.set(tail, head.length + pdfBytes.length)

  const res = await fetchWithTimeout(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink&${ALL_DRIVES_QS}`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
    },
    30000,
  )
  const data = await res.json()
  if (!data.id) throw new Error(`Drive upload: HTTP ${res.status} ${JSON.stringify(data)}`)
  return { fileId: data.id, webViewLink: data.webViewLink, dedup: 0 }
}

/**
 * Lista todos os PDFs no Shared Drive (diagnóstico de duplicatas).
 */
export async function listarTodosPdfs({ env }) {
  const token = await getAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const out   = []
  let pageToken = null
  do {
    const url = new URL(`${DRIVE_API}/files`)
    url.searchParams.set('q', "mimeType='application/pdf' and trashed=false")
    url.searchParams.set('fields', 'files(id,name,parents,createdTime),nextPageToken')
    url.searchParams.set('pageSize', '200')
    url.searchParams.set('supportsAllDrives', 'true')
    url.searchParams.set('includeItemsFromAllDrives', 'true')
    url.searchParams.set('corpora', 'drive')
    url.searchParams.set('driveId', env.GOOGLE_DRIVE_SHARED_ID ?? env.GOOGLE_DRIVE_ROOT_FOLDER)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res  = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, 15000)
    const data = await res.json()
    if (data.files) out.push(...data.files)
    pageToken = data.nextPageToken
  } while (pageToken && out.length < 1000)
  return out
}

/**
 * Apaga arquivo no Drive (move para lixeira do Shared Drive).
 */
export async function deletarArquivoDrive({ env, fileId }) {
  const token = await getAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const res   = await fetchWithTimeout(
    `${DRIVE_API}/files/${fileId}?${ALL_DRIVES_QS}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  if (!res.ok && res.status !== 404) {
    const txt = await res.text()
    throw new Error(`Drive delete: HTTP ${res.status} ${txt}`)
  }
  return { ok: true }
}

/**
 * Move arquivo no Drive para a pasta de outro produto (mantém status atual).
 * Usado para corrigir notas emitidas com product_id errado.
 */
export async function moverNotaParaProduto({ env, fileId, produto, status, dataEmissao }) {
  const token  = await getAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER

  const prodFolderName = `${produto.product_id} - ${produto.nome}`
  const prodFolderId   = await ensureFolder(token, prodFolderName, rootId, env.DB)
  const statusName     = status === 'cancelada' ? 'Notas Canceladas' : 'Notas Emitidas'
  const statusFolderId = await ensureFolder(token, statusName, prodFolderId, env.DB)
  const date           = dataEmissao ? new Date(dataEmissao) : new Date()
  const mm             = String(date.getMonth() + 1).padStart(2, '0')
  const aa             = String(date.getFullYear()).slice(2)
  const monthFolderId  = await ensureFolder(token, `${produto.nome} - ${mm}/${aa}`, statusFolderId, env.DB)

  const infoRes    = await fetchWithTimeout(
    `${DRIVE_API}/files/${fileId}?fields=parents&${ALL_DRIVES_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const info       = await infoRes.json()
  const oldParents = (info.parents ?? []).join(',')

  const res  = await fetchWithTimeout(
    `${DRIVE_API}/files/${fileId}?addParents=${monthFolderId}&removeParents=${oldParents}&fields=id,webViewLink&${ALL_DRIVES_QS}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const data = await res.json()
  if (!data.id) throw new Error(`Drive move: HTTP ${res.status} ${JSON.stringify(data)}`)
  return { webViewLink: data.webViewLink }
}

/**
 * Move um arquivo existente no Drive para a pasta "Notas Canceladas/[nome] - MM/AA".
 * Remove-o da pasta atual e adiciona à pasta de destino.
 */
export async function moverNotaParaCanceladas({ env, fileId, produto, dataEmissao }) {
  const token  = await getAccessToken(env.GOOGLE_CLIENT_EMAIL, env.GOOGLE_PRIVATE_KEY)
  const rootId = env.GOOGLE_DRIVE_ROOT_FOLDER

  // Garante pasta destino
  const prodFolderName    = `${produto.product_id} - ${produto.nome}`
  const prodFolderId      = await ensureFolder(token, prodFolderName, rootId, env.DB)
  const cancelFolderId    = await ensureFolder(token, 'Notas Canceladas', prodFolderId, env.DB)
  const date              = dataEmissao ? new Date(dataEmissao) : new Date()
  const mm                = String(date.getMonth() + 1).padStart(2, '0')
  const aa                = String(date.getFullYear()).slice(2)
  const monthFolderId     = await ensureFolder(token, `${produto.nome} - ${mm}/${aa}`, cancelFolderId, env.DB)

  // Busca parents atuais para removê-los
  const infoRes  = await fetchWithTimeout(
    `${DRIVE_API}/files/${fileId}?fields=parents&${ALL_DRIVES_QS}`,
    { headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const info     = await infoRes.json()
  const oldParents = (info.parents ?? []).join(',')

  const res  = await fetchWithTimeout(
    `${DRIVE_API}/files/${fileId}?addParents=${monthFolderId}&removeParents=${oldParents}&fields=id,webViewLink&${ALL_DRIVES_QS}`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
    10000,
  )
  const data = await res.json()
  if (!data.id) throw new Error(`Drive move: HTTP ${res.status} ${JSON.stringify(data)}`)
  return { webViewLink: data.webViewLink }
}
