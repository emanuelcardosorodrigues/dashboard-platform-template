import { describe, test, expect } from 'vitest'
import {
  DATA_DOMAINS,
  ALL_DOMAIN_IDS,
  canAccessDomain,
  allowedDomains,
  domainForPath,
  isDomainId,
  sanitizeDomainIds,
  type DomainAccessInput,
} from './access'
import { DASHBOARD_PATHS } from './auth'

const admin = (dd?: string[] | null): DomainAccessInput => ({ role: 'admin', ai_config: { data_domains: dd } })
const viewer = (dd?: string[] | null): DomainAccessInput => ({ role: 'viewer', ai_config: { data_domains: dd } })

describe('canAccessDomain — fail-closed semantics', () => {
  test('admin sempre true, ignora data_domains (inclusive [])', () => {
    expect(canAccessDomain(admin([]), 'criativos')).toBe(true)
    expect(canAccessDomain(admin(['funil']), 'financeiro')).toBe(true)
    expect(canAccessDomain(admin(undefined), 'organico')).toBe(true)
  })

  test('viewer não configurado (undefined) → TODOS (compat)', () => {
    expect(canAccessDomain(viewer(undefined), 'criativos')).toBe(true)
    expect(canAccessDomain(viewer(null), 'financeiro')).toBe(true)
  })

  test('viewer [] → NENHUM (explicitamente negado)', () => {
    for (const id of ALL_DOMAIN_IDS) {
      expect(canAccessDomain(viewer([]), id)).toBe(false)
    }
  })

  test('viewer com lista → só os concedidos', () => {
    expect(canAccessDomain(viewer(['funil']), 'funil')).toBe(true)
    expect(canAccessDomain(viewer(['funil']), 'criativos')).toBe(false)
  })

  test('ai_config ausente (undefined/null) → não configurado → TODOS', () => {
    expect(canAccessDomain({ role: 'viewer', ai_config: null }, 'criativos')).toBe(true)
    expect(canAccessDomain({ role: 'viewer', ai_config: undefined }, 'criativos')).toBe(true)
  })
})

describe('allowedDomains', () => {
  test('admin → todos', () => {
    expect(allowedDomains(admin([]))).toEqual(ALL_DOMAIN_IDS)
  })
  test('viewer não configurado → todos (compat)', () => {
    expect(allowedDomains(viewer(undefined))).toEqual(ALL_DOMAIN_IDS)
  })
  test('viewer [] → vazio', () => {
    expect(allowedDomains(viewer([]))).toEqual([])
  })
  test('viewer com lista → interseção na ordem do catálogo, descarta lixo', () => {
    expect(allowedDomains(viewer(['financeiro', 'INVALIDO', 'criativos']))).toEqual(['criativos', 'financeiro'])
  })
})

describe('domainForPath', () => {
  test('cada rota de DASHBOARD_PATHS mapeia pra um domínio (cobertura total)', () => {
    for (const path of DASHBOARD_PATHS) {
      expect(domainForPath(path), `${path} sem domínio`).not.toBeNull()
    }
  })

  test('sub-rotas /organico/* caem em organico via borda "/"', () => {
    expect(domainForPath('/organico/instagram')).toBe('organico')
    expect(domainForPath('/organico')).toBe('organico')
  })

  test('/criativos-ia não vaza pra /criativos (match por prefixo mais longo)', () => {
    expect(domainForPath('/criativos-ia')).toBe('criativos')
    expect(domainForPath('/criativos')).toBe('criativos')
  })

  test('ignora querystring e hash', () => {
    expect(domainForPath('/funil?de=2026-01-01&funil=all')).toBe('funil')
    expect(domainForPath('/financeiro#top')).toBe('financeiro')
  })

  test('rota fora do catálogo → null', () => {
    expect(domainForPath('/admin')).toBeNull()
    expect(domainForPath('')).toBeNull()
  })
})

describe('catálogo / helpers', () => {
  test('ids únicos', () => {
    expect(new Set(ALL_DOMAIN_IDS).size).toBe(DATA_DOMAINS.length)
  })
  test('isDomainId', () => {
    expect(isDomainId('funil')).toBe(true)
    expect(isDomainId('nope')).toBe(false)
    expect(isDomainId(42)).toBe(false)
  })
  test('sanitizeDomainIds dedup + ordem do catálogo + descarta inválidos', () => {
    expect(sanitizeDomainIds(['funil', 'funil', 'x', 'criativos'])).toEqual(['criativos', 'funil'])
    expect(sanitizeDomainIds([])).toEqual([])
  })
})
