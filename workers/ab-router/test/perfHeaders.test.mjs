import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addPerfHeaders } from '../src/ab.js'

test('addPerfHeaders adiciona Link preconnect para WP, GTM e Pixel', () => {
  const h = new Headers()
  addPerfHeaders(h, { WP_DOMAIN: 'example.com' })
  const links = []
  for (const [k, v] of h) if (k.toLowerCase() === 'link') links.push(v)
  assert.ok(links.some(l => l.includes('example.com') && l.includes('preconnect')), 'WP preconnect ausente')
  assert.ok(links.some(l => l.includes('googletagmanager.com')), 'GTM preconnect ausente')
  assert.ok(links.some(l => l.includes('connect.facebook.net')), 'Pixel preconnect ausente')
})

test('addPerfHeaders usa fallback quando WP_DOMAIN ausente', () => {
  const h = new Headers()
  addPerfHeaders(h, {})
  const combined = h.get('link') ?? ''
  assert.ok(combined.includes('preconnect'), 'deve ter preconnect sem WP_DOMAIN')
  assert.ok(combined.includes('googletagmanager.com'), 'GTM preconnect ausente')
  assert.ok(combined.includes('connect.facebook.net'), 'Pixel preconnect ausente')
})

test('addPerfHeaders cobre o bloco padrão das landings (Meta + TikTok + Clarity + GTM server-side + S3 CAPI)', () => {
  const h = new Headers()
  addPerfHeaders(h, { WP_DOMAIN: 'example.com' })
  const combined = h.get('link') ?? ''
  // GTM server-side
  assert.ok(combined.includes('ts.example.com'), 'ts.example preconnect ausente')
  // Meta browser-side (já tinha connect.facebook.net; agora também www.facebook.com)
  assert.ok(combined.includes('www.facebook.com'), 'www.facebook.com preconnect ausente')
  // TikTok
  assert.ok(combined.includes('analytics.tiktok.com'), 'TikTok preconnect ausente')
  // Clarity (dns-prefetch x3)
  assert.ok(combined.includes('scripts.clarity.ms'), 'scripts.clarity.ms ausente')
  assert.ok(combined.includes('www.clarity.ms'), 'www.clarity.ms ausente')
  assert.ok(combined.includes('r.clarity.ms'), 'r.clarity.ms ausente')
})
