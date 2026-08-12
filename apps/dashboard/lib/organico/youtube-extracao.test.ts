/**
 * Testes das funções de EXTRAÇÃO COMPLETA de comentários (Extrair Comentários).
 * Separado de youtube.test.ts de propósito: essas funções são novas e não
 * tocam fetchCommentThreads (usada pelo cron sync-organic-comments).
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  extractYoutubeVideoId,
  fetchCommentThreadsChunk,
  fetchAllReplies,
} from './youtube'

// ── helpers de mock ──────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function apiError(status: number, reason: string, message = 'erro'): Response {
  return jsonResponse({ error: { message, errors: [{ reason }] } }, status)
}

/** Item de commentThreads.list: raiz com `inline` replies embutidas. */
function thread(id: string, totalReplyCount = 0, inline = 0) {
  return {
    id,
    snippet: {
      totalReplyCount,
      topLevelComment: {
        id,
        snippet: {
          textOriginal: `texto ${id}`,
          authorDisplayName: `autor ${id}`,
          authorChannelUrl: `https://www.youtube.com/channel/UC_${id}`,
          likeCount: 3,
          publishedAt: '2026-01-01T00:00:00Z',
        },
      },
    },
    ...(inline > 0
      ? {
          replies: {
            comments: Array.from({ length: inline }, (_, i) => ({
              id: `${id}.r${i}`,
              snippet: {
                textOriginal: `reply ${i} de ${id}`,
                authorDisplayName: `resp ${i}`,
                authorChannelUrl: null,
                likeCount: 0,
                publishedAt: '2026-01-02T00:00:00Z',
                parentId: id,
              },
            })),
          },
        }
      : {}),
  }
}

function reply(parentId: string, i: number) {
  return {
    id: `${parentId}.r${i}`,
    snippet: {
      textOriginal: `reply ${i}`,
      authorDisplayName: `resp ${i}`,
      likeCount: 1,
      publishedAt: '2026-01-02T00:00:00Z',
      parentId,
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── extractYoutubeVideoId ────────────────────────────────────────────────────

describe('extractYoutubeVideoId', () => {
  const ID = 'dQw4w9WgXcQ' // 11 chars válidos

  test('watch?v= clássico', () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
  })
  test('watch com outros params antes do v', () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/watch?app=desktop&v=${ID}&t=30s`)).toBe(ID)
  })
  test('youtu.be com timestamp', () => {
    expect(extractYoutubeVideoId(`https://youtu.be/${ID}?t=30`)).toBe(ID)
  })
  test('shorts', () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
  })
  test('live', () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID)
  })
  test('embed', () => {
    expect(extractYoutubeVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
  })
  test('m.youtube.com e sem https', () => {
    expect(extractYoutubeVideoId(`m.youtube.com/watch?v=${ID}`)).toBe(ID)
    expect(extractYoutubeVideoId(`http://youtube.com/watch?v=${ID}`)).toBe(ID)
  })
  test('espaços em volta são tolerados', () => {
    expect(extractYoutubeVideoId(`  https://youtu.be/${ID}  `)).toBe(ID)
  })
  test('URL de outra plataforma → null', () => {
    expect(extractYoutubeVideoId('https://instagram.com/p/ABC123def45/')).toBeNull()
  })
  test('texto solto de 11 chars NÃO é aceito (sem URL, sem chute)', () => {
    expect(extractYoutubeVideoId('comentarios')).toBeNull()
    expect(extractYoutubeVideoId(ID)).toBeNull()
  })
  test('lixo e vazio → null', () => {
    expect(extractYoutubeVideoId('')).toBeNull()
    expect(extractYoutubeVideoId('youtube ponto com')).toBeNull()
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=curto')).toBeNull()
  })
})

// ── fetchCommentThreadsChunk ─────────────────────────────────────────────────

describe('fetchCommentThreadsChunk', () => {
  test('1 página: raízes + replies inline mapeadas; incompletas detectadas por comparação', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        items: [
          thread('a', 0, 0), // sem replies
          thread('b', 2, 2), // 2 replies, 2 inline → completa
          thread('c', 7, 5), // 7 replies, só 5 inline → INCOMPLETA
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', {})
    expect(r.commentsDisabled).toBe(false)
    expect(r.quotaExceeded).toBe(false)
    expect(r.nextPageToken).toBeNull()
    expect(r.pagesFetched).toBe(1)

    const roots = r.comments.filter((c) => c.parentExternalId === null)
    const replies = r.comments.filter((c) => c.parentExternalId !== null)
    expect(roots.map((c) => c.externalId)).toEqual(['a', 'b', 'c'])
    expect(replies).toHaveLength(7) // 2 do b + 5 do c
    expect(replies.every((c) => c.replyCount === null)).toBe(true)
    expect(roots.find((c) => c.externalId === 'c')?.replyCount).toBe(7)
    expect(r.incompleteThreadIds).toEqual(['c'])

    // parâmetros da chamada: part inclui replies, order=time (paginação estável)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('part=snippet%2Creplies')
    expect(url).toContain('order=time')
    expect(url).toContain('videoId=vid')
  })

  test('paginação respeita maxPages e devolve nextPageToken pra continuar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [thread('p1', 0, 0)], nextPageToken: 'T2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [thread('p2', 0, 0)], nextPageToken: 'T3' }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', { maxPages: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=T2')
    expect(r.nextPageToken).toBe('T3')
    expect(r.pagesFetched).toBe(2)
    expect(r.comments.map((c) => c.externalId)).toEqual(['p1', 'p2'])
  })

  test('retoma a partir de pageToken salvo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [thread('x', 0, 0)] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', { pageToken: 'SALVO' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('pageToken=SALVO')
  })

  test('403 commentsDisabled → flag, sem throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(apiError(403, 'commentsDisabled')))
    const r = await fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', {})
    expect(r.commentsDisabled).toBe(true)
    expect(r.comments).toEqual([])
  })

  test('403 quotaExceeded no meio → devolve o que coletou + token de retomada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [thread('ok1', 0, 0)], nextPageToken: 'T2' }))
      .mockResolvedValueOnce(apiError(403, 'quotaExceeded'))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', { maxPages: 5 })
    expect(r.quotaExceeded).toBe(true)
    expect(r.comments.map((c) => c.externalId)).toEqual(['ok1'])
    // token da página que FALHOU (retomada re-tenta ela; upsert dedup torna seguro)
    expect(r.nextPageToken).toBe('T2')
    expect(r.pagesFetched).toBe(1)
  })

  test('erro não-classificado (500) → throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(apiError(500, 'backendError')))
    await expect(fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', {})).rejects.toThrow()
  })

  test('403 insufficientPermissions → erro ACIONÁVEL (cita YOUTUBE_API_KEY)', async () => {
    // regressão do incidente em produção: token OAuth sem youtube.force-ssl
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(
      apiError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.'),
    ))
    await expect(fetchCommentThreadsChunk({ accessToken: 'tok' }, 'vid', {})).rejects.toThrow(/YOUTUBE_API_KEY/)
  })

  test('auth por API key: key= na URL e SEM header Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [thread('a', 0, 0)] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchCommentThreadsChunk({ apiKey: 'MINHA_KEY' }, 'vid', {})
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('key=MINHA_KEY')
    expect((init as RequestInit).headers).toEqual({})
  })
})

// ── fetchAllReplies ──────────────────────────────────────────────────────────

describe('fetchAllReplies', () => {
  test('pagina até o fim → nextPageToken null (raiz completa)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 0), reply('pai', 1)], nextPageToken: 'R2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 2)] }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchAllReplies({ accessToken: 'tok' }, 'pai')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('parentId=pai')
    expect(r.replies).toHaveLength(3)
    expect(r.replies.every((c) => c.parentExternalId === 'pai')).toBe(true)
    expect(r.replies.every((c) => c.replyCount === null)).toBe(true)
    expect(r.pagesFetched).toBe(2)
    expect(r.quotaExceeded).toBe(false)
    expect(r.nextPageToken).toBeNull() // completa → caller marca replies_fetched=true
  })

  test('teto de páginas com token pendente → nextPageToken não-null (NÃO perde replies)', async () => {
    // regressão do achado Alta: thread grande não pode sumir silenciosamente
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 0)], nextPageToken: 'R2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 1)], nextPageToken: 'R3' }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchAllReplies({ accessToken: 'tok' }, 'pai', { maxPages: 2 })
    expect(r.replies).toHaveLength(2)
    expect(r.nextPageToken).toBe('R3') // HÁ MAIS → caller NÃO marca completa
  })

  test('retoma a partir de opts.pageToken salvo', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 5)] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchAllReplies({ accessToken: 'tok' }, 'pai', { pageToken: 'CURSOR_SALVO' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('pageToken=CURSOR_SALVO')
  })

  test('deadline corta no meio (após 1ª pág) e devolve cursor', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 0)], nextPageToken: 'R2' }))
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 1)], nextPageToken: 'R3' }))
    vi.stubGlobal('fetch', fetchMock)

    // deadline no passado: corta antes da 2ª página, mas garante ao menos a 1ª
    const r = await fetchAllReplies({ accessToken: 'tok' }, 'pai', { deadlineMs: Date.parse('2000-01-01') })
    expect(fetchMock).toHaveBeenCalledTimes(1) // só a 1ª página
    expect(r.replies).toHaveLength(1)
    expect(r.nextPageToken).toBe('R2') // retoma daqui
    expect(r.quotaExceeded).toBe(false)
  })

  test('quotaExceeded no meio → parcial + flag + cursor de retomada', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [reply('pai', 0)], nextPageToken: 'R2' }))
      .mockResolvedValueOnce(apiError(403, 'quotaExceeded'))
    vi.stubGlobal('fetch', fetchMock)

    const r = await fetchAllReplies({ accessToken: 'tok' }, 'pai')
    expect(r.quotaExceeded).toBe(true)
    expect(r.replies).toHaveLength(1)
    expect(r.nextPageToken).toBe('R2') // token da página que falhou = ponto de retomada
  })

  test('erro não-classificado → throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(apiError(500, 'backendError')))
    await expect(fetchAllReplies({ accessToken: 'tok' }, 'pai')).rejects.toThrow()
  })
})
