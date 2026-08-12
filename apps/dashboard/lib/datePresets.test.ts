import { describe, expect, it } from 'vitest'
import {
  DATE_PRESETS,
  DEFAULT_PRESET_LABEL,
  DEFAULT_PRESET_STORAGE_KEY,
  findPreset,
  isValidPresetLabel,
  resolvePreset,
  INICIO_DA_OPERACAO,
} from './datePresets'
import { todayBR, daysAgoBR } from './formatters'

describe('DATE_PRESETS — a lista que o Header mostrava, agora compartilhada', () => {
  it('mantém os mesmos 6 presets, na mesma ordem', () => {
    expect(DATE_PRESETS.map((p) => p.label)).toEqual(['Hoje', 'Ontem', '7d', '30d', '90d', 'Tudo'])
  })

  it('cada preset devolve o mesmo intervalo que o Header calculava', () => {
    const esperado: Record<string, [string, string]> = {
      Hoje: [todayBR(), todayBR()],
      Ontem: [daysAgoBR(1), daysAgoBR(1)],
      '7d': [daysAgoBR(7), todayBR()],
      '30d': [daysAgoBR(30), todayBR()],
      '90d': [daysAgoBR(90), todayBR()],
      Tudo: [INICIO_DA_OPERACAO, todayBR()],
    }
    for (const p of DATE_PRESETS) {
      expect([p.de(), p.ate()]).toEqual(esperado[p.label])
    }
  })

  it('o fallback continua sendo 30d e a chave de localStorage não mudou', () => {
    // Mudar a chave apagaria a preferência de quem já usa o app.
    expect(DEFAULT_PRESET_LABEL).toBe('30d')
    expect(DEFAULT_PRESET_STORAGE_KEY).toBe('demo-default-date-preset')
    expect(findPreset(DEFAULT_PRESET_LABEL)).not.toBeNull()
  })
})

describe('resolvePreset — o servidor consegue virar rótulo em datas', () => {
  it('resolve um rótulo conhecido', () => {
    expect(resolvePreset('Tudo')).toEqual({ de: INICIO_DA_OPERACAO, ate: todayBR() })
  })

  it('CONTROLE NEGATIVO: rótulo desconhecido não vira período chutado', () => {
    for (const lixo of ['', '  ', '31d', 'tudo', 'Todos', null, undefined]) {
      expect(resolvePreset(lixo)).toBeNull()
      expect(isValidPresetLabel(lixo)).toBe(false)
    }
  })

  it('"Tudo" e "30d" produzem intervalos DIFERENTES — é a divergência que o dono viu', () => {
    const tudo = resolvePreset('Tudo')!
    const trinta = resolvePreset('30d')!
    expect(tudo.de).not.toBe(trinta.de)
    expect(tudo.de < trinta.de).toBe(true)
  })
})
