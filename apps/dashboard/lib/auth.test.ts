import { describe, expect, test } from 'vitest'
import {
  canAccessCreativeAnalysis,
  creativeAnalysisHrefForAllowedPaths,
  isCreativeAnalysisTabAllowed,
  normalizeCreativeAnalysisTab,
} from './auth'

describe('compatibilidade de permissões da Análise de Criativos', () => {
  test('normaliza tab ausente ou inválida para Cards', () => {
    expect(normalizeCreativeAnalysisTab(undefined)).toBe('cards')
    expect(normalizeCreativeAnalysisTab('desconhecida')).toBe('cards')
    expect(normalizeCreativeAnalysisTab('historico')).toBe('historico')
  })

  test('grants legados só liberam sua própria sub-aba', () => {
    expect(isCreativeAnalysisTabAllowed(['/criativos'], 'criativos')).toBe(true)
    expect(isCreativeAnalysisTabAllowed(['/criativos'], 'cards')).toBe(false)
    expect(isCreativeAnalysisTabAllowed(['/criativos'], 'historico')).toBe(false)
    expect(isCreativeAnalysisTabAllowed(['/criativos'], 'insights')).toBe(false)

    expect(isCreativeAnalysisTabAllowed(['/insights-ia'], 'insights')).toBe(true)
    expect(isCreativeAnalysisTabAllowed(['/insights-ia'], 'cards')).toBe(false)
    expect(isCreativeAnalysisTabAllowed(['/insights-ia'], 'criativos')).toBe(false)
  })

  test('grant atual libera Cards e Histórico, não as sub-abas legadas', () => {
    expect(isCreativeAnalysisTabAllowed(['/criativos-ia'], 'cards')).toBe(true)
    expect(isCreativeAnalysisTabAllowed(['/criativos-ia'], 'historico')).toBe(true)
    expect(isCreativeAnalysisTabAllowed(['/criativos-ia'], 'criativos')).toBe(false)
    expect(isCreativeAnalysisTabAllowed(['/criativos-ia'], 'insights')).toBe(false)
  })

  test('link único aponta para a primeira sub-aba autorizada', () => {
    expect(canAccessCreativeAnalysis(['/criativos'])).toBe(true)
    expect(creativeAnalysisHrefForAllowedPaths(['/criativos'])).toBe('/criativos-ia?tab=criativos')
    expect(creativeAnalysisHrefForAllowedPaths(['/insights-ia'])).toBe('/criativos-ia?tab=insights')
    expect(creativeAnalysisHrefForAllowedPaths(['/criativos-ia', '/criativos'])).toBe('/criativos-ia')
  })
})
