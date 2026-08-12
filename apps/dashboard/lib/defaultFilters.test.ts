import { describe, expect, it } from 'vitest'
import { applyDefaultFilters } from './defaultFilters'
import { resolvePreset } from './datePresets'
import type { DefaultFilters } from './sessions'

const aplicar = (href: string, f: DefaultFilters) => {
  const url = new URL(href)
  applyDefaultFilters(url, f)
  return url
}

describe('applyDefaultFilters — preset de período POR USUÁRIO', () => {
  it('sem de/ate na URL, o preset do usuário vira intervalo', () => {
    const url = aplicar('https://dashboard.example.com/visao-geral', { periodo: 'Tudo' })
    const esperado = resolvePreset('Tudo')!
    expect(url.searchParams.get('de')).toBe(esperado.de)
    expect(url.searchParams.get('ate')).toBe(esperado.ate)
  })

  it('CONTROLE NEGATIVO: o preset NÃO é aplicado quando a URL já tem intervalo', () => {
    const url = aplicar(
      'https://dashboard.example.com/visao-geral?de=2026-03-01&ate=2026-03-31',
      { periodo: 'Tudo' },
    )
    expect(url.searchParams.get('de')).toBe('2026-03-01')
    expect(url.searchParams.get('ate')).toBe('2026-03-31')
    expect(url.searchParams.get('de')).not.toBe(resolvePreset('Tudo')!.de)
  })

  it('datas fixas do perfil (admin) vencem o preset', () => {
    const url = aplicar('https://dashboard.example.com/visao-geral', {
      de: '2026-01-15',
      ate: '2026-02-15',
      periodo: 'Tudo',
    })
    expect(url.searchParams.get('de')).toBe('2026-01-15')
    expect(url.searchParams.get('ate')).toBe('2026-02-15')
  })

  it('preset inválido não inventa intervalo', () => {
    const url = aplicar('https://dashboard.example.com/visao-geral', { periodo: '31d' })
    expect(url.searchParams.has('de')).toBe(false)
    expect(url.searchParams.has('ate')).toBe(false)
  })

  it('funil e conta continuam funcionando como antes, sem pisar na URL', () => {
    const url = aplicar('https://dashboard.example.com/visao-geral?funil=lps', {
      funil: 'col',
      conta: '111111111111111',
    })
    expect(url.searchParams.get('funil')).toBe('lps')
    expect(url.searchParams.get('conta')).toBe('111111111111111')
  })

  it('sem preferência nenhuma, a URL sai intacta', () => {
    const url = aplicar('https://dashboard.example.com/visao-geral', {})
    expect(url.search).toBe('')
  })

  it('dois dispositivos com a MESMA preferência veem o MESMO intervalo', () => {
    // É o defeito medido: desktop em "Tudo" e PWA em "30d" mostravam faturamentos
    // que diferiam 9,1x porque a preferência morava no localStorage de cada um.
    const prefs: DefaultFilters = { periodo: '30d' }
    const desktop = aplicar('https://dashboard.example.com/visao-geral', prefs)
    const pwa = aplicar('https://dashboard.example.com/visao-geral', prefs)
    expect(desktop.search).toBe(pwa.search)
    expect(desktop.searchParams.get('de')).toBe(resolvePreset('30d')!.de)
  })
})
