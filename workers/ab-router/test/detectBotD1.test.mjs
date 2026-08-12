import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectBot } from '../src/ab.js'

function makeRequest({ ip = '1.2.3.4', ua = '', lang = null, cf = {} } = {}) {
  return {
    headers: {
      get(name) {
        const n = name.toLowerCase()
        if (n === 'cf-connecting-ip') return ip
        if (n === 'user-agent') return ua
        if (n === 'accept-language') return lang
        return null
      },
    },
    cf,
  }
}

function makeDB(found) {
  return {
    prepare(_sql) {
      return {
        bind(_ip) {
          return { async first() { return found ? { x: 1 } : null } }
        },
      }
    },
  }
}

const ctx = { waitUntil: () => {} }

test('detectBot Layer4: bloqueia IP presente em bot_fingerprints D1', async () => {
  const req = makeRequest({ ip: '1.2.3.4' })
  assert.equal(await detectBot(req, { DB: makeDB(true) }, ctx), true)
})

test('detectBot Layer4: libera IP ausente em bot_fingerprints D1', async () => {
  const req = makeRequest({ ip: '5.6.7.8' })
  assert.equal(await detectBot(req, { DB: makeDB(false) }, ctx), false)
})

test('detectBot Layer4: sem D1 não bloqueia', async () => {
  const req = makeRequest({ ip: '5.6.7.8' })
  assert.equal(await detectBot(req, {}, ctx), false)
})

test('detectBot Layer4: IP vazio não consulta D1 (não bloqueia)', async () => {
  const req = makeRequest({ ip: '' })
  assert.equal(await detectBot(req, { DB: makeDB(true) }, ctx), false)
})
