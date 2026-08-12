import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isThumbPermanente, thumbPath, persistThumbnail, THUMB_BUCKET } from './criativo-thumbnail'

/** URL real do demo-col-vid-29-g42-split (venceu em 01/07/2026, 403 em prod). */
const FBCDN_REAL =
  'https://scontent-iad3-1.xx.fbcdn.net/v/t15.5256-10/658854381_2015855462682204_8723166471401585120_n.jpg?_nc_cat=101&oe=6A457E3C'
const STORAGE_REAL =
  'https://SEU_PROJECT_REF.supabase.co/storage/v1/object/public/criativos/AD_ID_DEMO/frame_00_hook.jpg'

describe('isThumbPermanente', () => {
  test('só o nosso bucket é permanente', () => {
    expect(isThumbPermanente(STORAGE_REAL)).toBe(true)
  })

  test('fbcdn não é', () => {
    expect(isThumbPermanente(FBCDN_REAL)).toBe(false)
    expect(isThumbPermanente('https://scontent-iad6-1.xx.fbcdn.net/v/t15/x.jpg')).toBe(false)
  })

  test('cdninstagram não é', () => {
    expect(isThumbPermanente('https://scontent.cdninstagram.com/v/t51/x.jpg')).toBe(false)
  })

  test('facebook.com/ads/image NÃO é — o caso que a lista de bloqueio deixou passar', () => {
    expect(isThumbPermanente('https://www.facebook.com/ads/image/?d=AQJUcioK6vbX54shyraw')).toBe(false)
  })

  test('default-deny: origem desconhecida nunca conta como permanente', () => {
    expect(isThumbPermanente('https://cdn.qualquer-coisa.com/x.jpg')).toBe(false)
  })

  test('outro bucket do mesmo projeto não vale — o path tem que ser o nosso', () => {
    expect(isThumbPermanente('https://SEU_PROJECT_REF.supabase.co/storage/v1/object/public/outro/x.jpg')).toBe(false)
  })

  test('host que só CONTÉM supabase.co não passa', () => {
    expect(isThumbPermanente('https://supabase.co.evil.com/storage/v1/object/public/criativos/x.jpg')).toBe(false)
  })

  test('null/vazio/lixo não quebra', () => {
    expect(isThumbPermanente(null)).toBe(false)
    expect(isThumbPermanente(undefined)).toBe(false)
    expect(isThumbPermanente('')).toBe(false)
    expect(isThumbPermanente('não é url')).toBe(false)
  })
})

test('thumbPath fica ao lado dos frames do mesmo ad', () => {
  expect(thumbPath('AD_ID_DEMO')).toBe('AD_ID_DEMO/thumb.jpg')
})

describe('persistThumbnail', () => {
  const upload = vi.fn()
  const getPublicUrl = vi.fn()
  const supa = {
    storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
  } as unknown as SupabaseClient

  beforeEach(() => {
    vi.restoreAllMocks()
    upload.mockReset().mockResolvedValue({ error: null })
    getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: STORAGE_REAL } })
  })

  afterEach(() => vi.unstubAllGlobals())

  test('URL permanente passa direto — não baixa nem sobe nada', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(persistThumbnail(supa, 'ad1', STORAGE_REAL)).resolves.toBe(STORAGE_REAL)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  test('facebook.com/ads/image também é copiada — não basta responder 200 hoje', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Headers() }),
    )

    await expect(persistThumbnail(supa, 'ad1', 'https://www.facebook.com/ads/image/?d=AQJUcio')).resolves.toBe(STORAGE_REAL)
    expect(upload).toHaveBeenCalled()
  })

  test('fbcdn é copiada pro bucket e devolve a URL NOSSA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      }),
    )

    await expect(persistThumbnail(supa, 'ad1', FBCDN_REAL)).resolves.toBe(STORAGE_REAL)
    expect(supa.storage.from).toHaveBeenCalledWith(THUMB_BUCKET)
    expect(upload).toHaveBeenCalledWith('ad1/thumb.jpg', expect.anything(), expect.objectContaining({ upsert: true, contentType: 'image/jpeg' }))
  })

  test('URL já vencida (403) devolve null — não grava link podre', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers() }))

    await expect(persistThumbnail(supa, 'ad1', FBCDN_REAL)).resolves.toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })

  test('upload falhou devolve null, não explode a análise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Headers() }),
    )
    upload.mockResolvedValue({ error: { message: 'bucket offline' } })

    await expect(persistThumbnail(supa, 'ad1', FBCDN_REAL)).resolves.toBeNull()
  })

  test('rede caiu devolve null, não propaga throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))

    await expect(persistThumbnail(supa, 'ad1', FBCDN_REAL)).resolves.toBeNull()
  })

  test('sem source não faz nada', async () => {
    await expect(persistThumbnail(supa, 'ad1', null)).resolves.toBeNull()
  })
})
