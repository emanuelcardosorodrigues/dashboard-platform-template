import { describe, expect, test } from 'vitest'
import { entryBaseForWorkspace, experimentEntryLink, experimentEntryUrl, normalizeAbEntryBase } from './abEntryLink'

describe('link A/B por projeto', () => {
  test('normaliza o domínio próprio do projeto e exige a rota /r', () => {
    expect(normalizeAbEntryBase('https://ThiagoMagalhaes.com.br/r/')).toBe('thiagomagalhaes.com.br/r')
    expect(normalizeAbEntryBase('thiagomagalhaes.com.br/outro')).toBeNull()
  })

  test('monta checkout e página com o domínio do projeto, não o legado', () => {
    const base = entryBaseForWorkspace('thiagomagalhaes.com.br/r', 'leandrostecca.com.br/r')
    expect(experimentEntryLink(base, 'checkout', '/diagnostico')).toBe('thiagomagalhaes.com.br/r/check/diagnostico')
    expect(experimentEntryUrl(base, 'page', '/diagnostico')).toBe('https://thiagomagalhaes.com.br/r/diagnostico')
  })
})
