import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBotUA } from '../src/ab.js'

test('detecta Meta/Facebook bots', () => {
  assert.ok(isBotUA('facebookexternalhit/1.1'))
  assert.ok(isBotUA('facebookcatalog/1.0'))
  assert.ok(isBotUA('meta-externalagent'))
})

test('detecta AI crawlers modernos', () => {
  assert.ok(isBotUA('GPTBot/1.0'))
  assert.ok(isBotUA('ClaudeBot/1.0'))
  assert.ok(isBotUA('Bytespider; +https://zhanzhang.toutiao.com/'))
  assert.ok(isBotUA('AmazonBot'))
  assert.ok(isBotUA('CCBot/2.0'))
})

test('detecta headless por padrão estrutural', () => {
  assert.ok(isBotUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/112.0'))
})

test('detecta Meta stealth Android K', () => {
  assert.ok(isBotUA('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'))
})

test('não bloqueia UAs humanos comuns', () => {
  assert.equal(isBotUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), false)
  assert.equal(isBotUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'), false)
  assert.equal(isBotUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15'), false)
})

test('não bloqueia UA vazio (sem UA pode ser humano legítimo)', () => {
  assert.equal(isBotUA(''), false)
})
