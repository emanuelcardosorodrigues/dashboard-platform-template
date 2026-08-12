// Testes do integrador Google Drive (src/drive.js).
//
// Mocka fetch global. Foco: garantir que `supportsAllDrives=true` está em
// todas as URLs (Shared Drive não funciona sem isso) e que o fluxo de
// upload/move respeita o shape esperado.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  uploadNotaToDrive,
  deletarArquivoDrive,
  moverNotaParaCanceladas,
  moverNotaParaProduto,
  listarTodosPdfs,
} from '../src/drive.js'

// === PEM helpers (gera chave dummy só pra getAccessToken não explodir) ===
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function toPem(b64, label) {
  const wrapped = b64.match(/.{1,64}/g).join('\n')
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`
}

async function genDummyKeyPem() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  return toPem(arrayBufferToBase64(pkcs8), 'PRIVATE KEY')
}

// Mock fetch que registra todas as URLs chamadas e retorna respostas
// configuráveis por padrão de URL.
function makeFetchRecorder(handlers = []) {
  const calls = []
  const fn = async (url, opts) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, opts })

    for (const h of handlers) {
      if (h.match(u, opts)) {
        if (typeof h.response === 'function') return h.response(u, opts)
        const status = h.response.status ?? 200
        // Status 204/205/304 não podem ter body (spec Fetch).
        const noBody = status === 204 || status === 205 || status === 304
        return new Response(noBody ? null : JSON.stringify(h.response.body ?? {}), {
          status,
          headers: noBody ? {} : { 'Content-Type': 'application/json' },
        })
      }
    }

    // Default: assumir token URL → access_token
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    // Default: arquivo/pasta criado com sucesso
    return new Response(JSON.stringify({ id: 'fake-id', webViewLink: 'https://drive/fake' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  fn.calls = calls
  return fn
}

describe('drive - getAccessToken + chamadas básicas', () => {
  let originalFetch
  let dummyKey
  beforeEach(async () => {
    originalFetch = globalThis.fetch
    dummyKey = await genDummyKeyPem()
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uploadNotaToDrive inclui supportsAllDrives=true em todas as URLs do Drive', async () => {
    globalThis.fetch = makeFetchRecorder([
      // findFolder retorna vazio (forçar criar)
      {
        match: (u) => u.includes('/files?q=') && u.includes('folder'),
        response: { body: { files: [] } },
      },
      // listar PDFs existentes → vazio (não-existe)
      {
        match: (u) => u.includes('/files?q=') && u.includes('.pdf'),
        response: { body: { files: [] } },
      },
      // upload final
      {
        match: (u) => u.includes('/upload/drive/v3/files'),
        response: { body: { id: 'novo-pdf-id', webViewLink: 'https://drive/pdf' } },
      },
    ])

    const env = {
      GOOGLE_CLIENT_EMAIL: 'service-account@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: dummyKey,
      GOOGLE_DRIVE_ROOT_FOLDER: 'root-folder-id',
      DB: null,
    }
    const result = await uploadNotaToDrive({
      env,
      pdfBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
      fileName: 'Cliente - 12345 - Produto - 4528762',
      produto: { product_id: '4528762', nome: 'Curso X' },
      status: 'emitida',
      dataEmissao: '2026-05-13T00:00:00Z',
    })

    expect(result.fileId).toBe('novo-pdf-id')

    // Todas as URLs do Drive API (exceto token OAuth) precisam ter o param.
    const driveCalls = globalThis.fetch.calls.filter((c) =>
      c.url.includes('googleapis.com/drive') || c.url.includes('googleapis.com/upload/drive'),
    )
    expect(driveCalls.length).toBeGreaterThan(0)
    for (const c of driveCalls) {
      expect(c.url).toMatch(/supportsAllDrives=true/)
    }
  })

  it('deletarArquivoDrive usa supportsAllDrives=true', async () => {
    globalThis.fetch = makeFetchRecorder([
      {
        match: (u) => u.includes('/files/abc-123'),
        response: { body: { ok: true }, status: 204 },
      },
    ])

    const env = {
      GOOGLE_CLIENT_EMAIL: 'service-account@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: dummyKey,
    }
    await deletarArquivoDrive({ env, fileId: 'abc-123' })

    const driveCall = globalThis.fetch.calls.find((c) => c.url.includes('/files/abc-123'))
    expect(driveCall.url).toMatch(/supportsAllDrives=true/)
  })

  it('moverNotaParaCanceladas inclui supportsAllDrives=true', async () => {
    globalThis.fetch = makeFetchRecorder([
      { match: (u) => u.includes('/files?q='), response: { body: { files: [{ id: 'folder-id' }] } } },
      {
        match: (u) => u.includes('/files/file-xyz?fields=parents'),
        response: { body: { parents: ['old-parent'] } },
      },
      {
        match: (u) => u.includes('/files/file-xyz?addParents'),
        response: { body: { id: 'file-xyz', webViewLink: 'https://drive/new' } },
      },
    ])

    const env = {
      GOOGLE_CLIENT_EMAIL: 'service-account@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: dummyKey,
      GOOGLE_DRIVE_ROOT_FOLDER: 'root',
    }
    await moverNotaParaCanceladas({
      env,
      fileId: 'file-xyz',
      produto: { product_id: '4528762', nome: 'Curso X' },
      dataEmissao: '2026-05-13T00:00:00Z',
    })

    const driveCalls = globalThis.fetch.calls.filter((c) =>
      c.url.includes('googleapis.com/drive'),
    )
    for (const c of driveCalls) {
      expect(c.url).toMatch(/supportsAllDrives=true/)
    }
  })

  it('moverNotaParaProduto inclui supportsAllDrives=true', async () => {
    globalThis.fetch = makeFetchRecorder([
      { match: (u) => u.includes('/files?q='), response: { body: { files: [{ id: 'folder-id' }] } } },
      {
        match: (u) => u.includes('?fields=parents'),
        response: { body: { parents: ['old-parent'] } },
      },
      {
        match: (u) => u.includes('addParents'),
        response: { body: { id: 'file-xyz', webViewLink: 'https://drive/new' } },
      },
    ])

    const env = {
      GOOGLE_CLIENT_EMAIL: 'service-account@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: dummyKey,
      GOOGLE_DRIVE_ROOT_FOLDER: 'root',
    }
    await moverNotaParaProduto({
      env,
      fileId: 'file-xyz',
      produto: { product_id: '4528762', nome: 'Curso X' },
      status: 'emitida',
      dataEmissao: '2026-05-13T00:00:00Z',
    })

    const driveCalls = globalThis.fetch.calls.filter((c) =>
      c.url.includes('googleapis.com/drive'),
    )
    for (const c of driveCalls) {
      expect(c.url).toMatch(/supportsAllDrives=true/)
    }
  })

  it('listarTodosPdfs usa supportsAllDrives=true e includeItemsFromAllDrives=true', async () => {
    globalThis.fetch = makeFetchRecorder([
      {
        match: (u) => u.includes('/files') && u.includes('mimeType'),
        response: { body: { files: [{ id: 'p1', name: 'p1.pdf' }] } },
      },
    ])

    const env = {
      GOOGLE_CLIENT_EMAIL: 'service-account@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: dummyKey,
      GOOGLE_DRIVE_ROOT_FOLDER: 'shared-drive-id',
    }
    const result = await listarTodosPdfs({ env })
    expect(result).toEqual([{ id: 'p1', name: 'p1.pdf' }])

    const listCall = globalThis.fetch.calls.find((c) =>
      c.url.includes('/drive/v3/files') && c.url.includes('mimeType'),
    )
    expect(listCall.url).toMatch(/supportsAllDrives=true/)
    expect(listCall.url).toMatch(/includeItemsFromAllDrives=true/)
  })
})
