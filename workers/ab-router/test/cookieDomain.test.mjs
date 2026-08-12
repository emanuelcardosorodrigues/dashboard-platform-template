import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUidCookie } from '../src/ab.js'

test('inclui Domain quando WP_DOMAIN setado', () => {
  const c = buildUidCookie('uid-1', { WP_DOMAIN: 'example.com' })
  assert.match(c, /Domain=\.example\.com/)
  assert.match(c, /SameSite=Lax/)
  assert.match(c, /Secure/)
  assert.match(c, /HttpOnly/)
  assert.match(c, /uid=uid-1/)
})

test('omite Domain quando WP_DOMAIN ausente', () => {
  const c = buildUidCookie('uid-1', {})
  assert.doesNotMatch(c, /Domain=/)
  assert.match(c, /uid=uid-1/)
})
