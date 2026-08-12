const SUSPICIOUS_PATTERNS = [
  /<script\b/i,
  /<iframe\b/i,
  /<svg\b[^>]*\bon\w+\s*=/i,
  /<img\b[^>]*\bon\w+\s*=/i,
  /\bon(?:click|error|load|focus|mouseover|submit)\s*=/i,
  /\bjavascript:\s*/i,
  /\bdata:text\/html/i,
  /<object\b/i,
  /<embed\b/i,
  /<link\b[^>]*\brel\s*=\s*["']?import/i,
]

const STRIP_TAGS = /<\/?(?:script|iframe|object|embed|link|style|meta|base|form|input|textarea|button|select|option)[^>]*>/gi

export function sanitizeAIResponse(text: string): string {
  if (typeof text !== 'string') return ''
  let cleaned = text.replace(STRIP_TAGS, '')
  cleaned = cleaned.replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
  cleaned = cleaned.replace(/\bjavascript:\s*/gi, '')
  cleaned = cleaned.replace(/\bdata:text\/html[^"'\s]*/gi, '')
  return cleaned
}

export function isResponseSuspicious(text: string): boolean {
  if (typeof text !== 'string') return false
  return SUSPICIOUS_PATTERNS.some(p => p.test(text))
}

// Strip control chars (exceto \n, \r, \t) e BOMs. Quem manda \x00 num form é ataque.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F﻿]/g

// Tags do tipo <usr_*> e <sys_*> são reservadas pro wrapper de input — bloqueia o
// user de tentar abrir/fechar uma tag dessas pra injetar instrução.
const RESERVED_TAGS = /<\/?(?:usr|sys)_[A-Za-z0-9_-]+\b[^>]*>/gi

export function sanitizeUserInput(text: string, maxLen = 1500): string {
  if (typeof text !== 'string') return ''
  let cleaned = text.replace(CONTROL_CHARS, '')
  cleaned = cleaned.replace(RESERVED_TAGS, '')
  cleaned = cleaned.trim()
  if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen)
  return cleaned
}

// Gera nonce hex de 16 bytes (32 chars) sem depender de Web Crypto presence check.
export function generateNonce(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

// Canary: se o LLM vazar esse token na resposta, a tentativa foi de prompt injection
// (o user induziu o modelo a repetir o system prompt). Descartar resposta + log.
export function hasCanaryLeak(text: string, canary: string): boolean {
  if (typeof text !== 'string' || !canary) return false
  return text.includes(canary)
}
