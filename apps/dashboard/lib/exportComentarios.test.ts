import { describe, test, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildComentariosCsv,
  buildComentariosWorkbook,
  buildComentariosMultiCsv,
  buildComentariosMultiWorkbook,
  ordenarThreads,
  comentariosFileName,
  type ComentarioExportRow,
  type ExtracaoExportMeta,
} from './exportComentarios'

const META: ExtracaoExportMeta = {
  videoId: 'dQw4w9WgXcQ',
  videoTitle: 'Vídeo de Teste: Ortodontia & Lucro',
  channelTitle: 'Canal Teste',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
}

function row(overrides: Partial<ComentarioExportRow>): ComentarioExportRow {
  return {
    external_id: 'c1',
    parent_external_id: null,
    author: 'Fulano',
    author_channel_url: null,
    text: 'Muito bom!',
    like_count: 2,
    reply_count: 0,
    published_at: '2026-06-01T12:00:00Z',
    ...overrides,
  }
}

describe('ordenarThreads', () => {
  test('replies ficam logo após a raiz correspondente', () => {
    const rows = [
      row({ external_id: 'a', reply_count: 2 }),
      row({ external_id: 'b' }),
      row({ external_id: 'a.r1', parent_external_id: 'a' }),
      row({ external_id: 'a.r2', parent_external_id: 'a' }),
    ]
    expect(ordenarThreads(rows).map((r) => r.external_id)).toEqual(['a', 'a.r1', 'a.r2', 'b'])
  })
  test('reply órfã (raiz fora do conjunto) vai pro final, não some', () => {
    const rows = [
      row({ external_id: 'b' }),
      row({ external_id: 'x.r1', parent_external_id: 'x' }),
    ]
    expect(ordenarThreads(rows).map((r) => r.external_id)).toEqual(['b', 'x.r1'])
  })
})

describe('buildComentariosCsv', () => {
  test('BOM + cabeçalho pt-BR + link com lc=', () => {
    const csv = buildComentariosCsv(META, [row({})])
    expect(csv.startsWith('﻿')).toBe(true)
    const [header, linha] = csv.slice(1).split('\r\n')
    expect(header).toBe('"Comentário","Autor","Curtidas","Respostas","Publicado em","Tipo","Em resposta a","Link"')
    expect(linha).toContain('"Muito bom!"')
    expect(linha).toContain('"comentário"')
    expect(linha).toContain(`watch?v=${META.videoId}&lc=c1`)
  })
  test('escapa aspas (RFC 4180) e preserva quebra de linha dentro da célula', () => {
    const csv = buildComentariosCsv(META, [row({ text: 'ele disse "top"\nsegunda linha' })])
    expect(csv).toContain('"ele disse ""top""\nsegunda linha"')
  })
  test('reply marca Tipo=resposta e aponta o pai', () => {
    const csv = buildComentariosCsv(META, [row({ external_id: 'r', parent_external_id: 'pai' })])
    expect(csv).toContain('"resposta"')
    expect(csv).toContain('"pai"')
  })
  test('campos nulos viram vazio, não "null"', () => {
    const csv = buildComentariosCsv(META, [row({ author: null, like_count: null, published_at: null })])
    expect(csv).not.toContain('null')
  })

  test('neutraliza formula injection em texto e autor (CWE-1236)', () => {
    const csv = buildComentariosCsv(META, [
      row({ text: '=HYPERLINK("http://evil","clique")', author: '@spam', external_id: 'f1' }),
      row({ text: '+1234', author: '-cmd', external_id: 'f2' }),
    ])
    // cada payload perigoso vem prefixado com apóstrofo → Excel trata como texto
    expect(csv).toContain('"\'=HYPERLINK')
    expect(csv).toContain('"\'@spam"')
    expect(csv).toContain('"\'+1234"')
    expect(csv).toContain('"\'-cmd"')
  })

  test('texto normal NÃO é prefixado', () => {
    const csv = buildComentariosCsv(META, [row({ text: 'ótimo vídeo, 10/10' })])
    expect(csv).toContain('"ótimo vídeo, 10/10"')
    expect(csv).not.toContain("'ótimo")
  })
})

describe('buildComentariosWorkbook', () => {
  test('abas Resumo + Comentários com dados corretos', () => {
    const wb = buildComentariosWorkbook(META, [row({}), row({ external_id: 'c2', parent_external_id: 'c1' })])
    expect(wb.SheetNames).toEqual(['Resumo', 'Comentários'])

    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Resumo'])
    expect(resumo.some((r) => r.Valor === META.videoTitle)).toBe(true)
    expect(resumo.some((r) => r.Valor === 2)).toBe(true) // total de comentários

    const comentarios = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Comentários'])
    expect(comentarios).toHaveLength(2)
    expect(comentarios[0]['Comentário']).toBe('Muito bom!')
    expect(comentarios[1]['Tipo']).toBe('resposta')
  })
})

describe('export multi-vídeo (seleção por checkbox)', () => {
  const META2: ExtracaoExportMeta = {
    videoId: 'abcdefghijk',
    videoTitle: 'Outro Vídeo',
    channelTitle: 'Canal 2',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
  }
  const itens = [
    { meta: META, rows: [row({ external_id: 'a' }), row({ external_id: 'a.r', parent_external_id: 'a' })] },
    { meta: META2, rows: [row({ external_id: 'b', text: 'do vídeo 2' })] },
  ]

  test('CSV: cabeçalho ganha Vídeo+Canal e cada linha identifica a origem', () => {
    const csv = buildComentariosMultiCsv(itens)
    const [header, l1, , l3] = csv.slice(1).split('\r\n')
    expect(header.startsWith('"Vídeo","Canal","Comentário"')).toBe(true)
    expect(l1).toContain(`"${META.videoTitle}"`)
    expect(l3).toContain('"Outro Vídeo"')
    expect(l3).toContain('"do vídeo 2"')
  })

  test('CSV: threads agrupadas dentro de cada vídeo (raiz seguida da reply)', () => {
    const csv = buildComentariosMultiCsv(itens)
    const linhas = csv.slice(1).split('\r\n')
    expect(linhas[1]).toContain('"comentário"') // raiz do vídeo 1
    expect(linhas[2]).toContain('"resposta"')   // reply logo após
  })

  test('XLSX: aba Resumo + UMA ABA POR VÍDEO com os comentários dele', () => {
    const wb = buildComentariosMultiWorkbook(itens)
    // nomes truncados a 28 chars e sanitizados
    expect(wb.SheetNames[0]).toBe('Resumo')
    expect(wb.SheetNames).toHaveLength(3) // Resumo + 2 vídeos
    const resumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Resumo'])
    expect(resumo).toHaveLength(3) // 2 vídeos + TOTAL
    expect(resumo[2]['Vídeo']).toBe('TOTAL (2 vídeos)')
    expect(resumo[2]['Comentários (raízes + respostas)']).toBe(3)
    // aba do vídeo 2 tem SÓ o comentário dele, com as colunas do export individual
    const aba2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Outro Vídeo'])
    expect(aba2).toHaveLength(1)
    expect(aba2[0]['Comentário']).toBe('do vídeo 2')
    expect(aba2[0]['Vídeo']).toBeUndefined() // a aba já identifica o vídeo
    // aba do vídeo 1: raiz + reply agrupadas
    const aba1Nome = wb.SheetNames.find((n) => n !== 'Resumo' && n !== 'Outro Vídeo')!
    const aba1 = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba1Nome])
    expect(aba1).toHaveLength(2)
    expect(aba1[1]['Tipo']).toBe('resposta')
  })

  test('nomes de aba: sanitiza chars proibidos, trunca em 28 e dedup com sufixo', () => {
    const meta = (t: string, id: string) => ({ videoId: id, videoTitle: t, channelTitle: null, url: 'u' })
    const wb = buildComentariosMultiWorkbook([
      { meta: meta('Como: vender [MUITO] / sem gastar? Guia completo 2026', 'id111111111'), rows: [row({ external_id: 'x1' })] },
      { meta: meta('Como: vender [MUITO] / sem gastar? Guia completo 2026', 'id222222222'), rows: [row({ external_id: 'x2' })] },
    ])
    const [_, aba1, aba2] = wb.SheetNames
    expect(aba1.length).toBeLessThanOrEqual(31)
    expect(aba1).not.toMatch(/[:\\/?*[\]]/)
    expect(aba2).toMatch(/\(2\)$/) // título igual → sufixo
    expect(aba1).not.toBe(aba2)
  })

  test('título de vídeo malicioso é neutralizado (formula injection)', () => {
    const csv = buildComentariosMultiCsv([
      { meta: { ...META2, videoTitle: '=HYPERLINK("http://evil")' }, rows: [row({})] },
    ])
    expect(csv).toContain('"\'=HYPERLINK')
  })
})

describe('comentariosFileName', () => {
  test('slug sem acento/caracteres especiais + extensão', () => {
    expect(comentariosFileName(META, 'csv')).toBe('comentarios-video-de-teste-ortodontia-lucro.csv')
    expect(comentariosFileName({ ...META, videoTitle: null }, 'xlsx')).toBe('comentarios-dQw4w9WgXcQ.xlsx')
  })
})
