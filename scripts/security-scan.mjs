import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = process.cwd()
const ignoredDirectories = new Set(['.git', 'node_modules', '.next', '.wrangler', 'coverage'])
const allowedEnvFiles = new Set(['.env.example', '.dev.vars.example'])
const forbiddenEnvNames = /(^|\/)(\.env|\.dev\.vars)(\..+)?$/
const checks = [
  ['private key material', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s*[A-Za-z0-9+/=]{24,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['GitHub personal token', /gh[pousr]_[A-Za-z0-9_]{30,}/],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ['OpenAI-style secret', /sk-[A-Za-z0-9_-]{20,}/],
  ['URL token segment', /https?:\/\/[^\s"']+\/[^\s"']*tok_[A-Za-z0-9_-]{12,}/i],
]

const findings = []

async function walk(directory) {
  for (const entry of await readdir(directory)) {
    const full = join(directory, entry)
    const rel = relative(root, full)
    const info = await stat(full)
    if (info.isDirectory()) {
      if (!ignoredDirectories.has(entry)) await walk(full)
      continue
    }
    if (forbiddenEnvNames.test(rel) && !allowedEnvFiles.has(entry)) {
      findings.push(`${rel}: arquivo de ambiente não permitido`)
      continue
    }
    if (info.size > 2_000_000) continue
    const content = await readFile(full, 'utf8').catch(() => null)
    if (content === null) continue
    for (const [label, pattern] of checks) {
      if (pattern.test(content)) findings.push(`${rel}: possível ${label}`)
    }
  }
}

await walk(root)
if (findings.length) {
  console.error('Security scan failed:\n' + findings.join('\n'))
  process.exit(1)
}
console.log('Security scan passed: no credential-shaped values or local environment files found.')
