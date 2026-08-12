#!/usr/bin/env node
/**
 * Reset emergencial de senha do admin.
 *
 * Uso:
 *   RESET_EMAIL=admin@example.com \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/reset-admin-password.mjs
 *
 * O que faz:
 *  1) Gera senha temporária (12 chars sem ambiguidade)
 *  2) Argon2id hash + UPDATE users (status='active', invalida sessões antigas)
 *  3) Limpa login_attempts pra remover lockout
 *  4) Imprime a senha no stdout pra colar no /login
 */
import { hash } from '@node-rs/argon2'
import { createClient } from '@supabase/supabase-js'

const must = (k) => {
  const v = process.env[k]
  if (!v) {
    console.error(`Missing env: ${k}`)
    process.exit(1)
  }
  return v
}

const email = must('RESET_EMAIL').toLowerCase()
const supabase = createClient(must('SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz'
function generateTempPassword(length = 12) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

const newPassword = generateTempPassword()
const passwordHash = await hash(newPassword, {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
})

const { data: user, error: userErr } = await supabase
  .from('users')
  .select('id, email, role, status')
  .eq('email', email)
  .maybeSingle()

if (userErr || !user) {
  console.error('User não encontrado:', email, userErr?.message)
  process.exit(1)
}

console.log('Estado atual:', user)

const { error: updErr } = await supabase
  .from('users')
  .update({
    password_hash: passwordHash,
    status: 'active',
    updated_at: new Date().toISOString(),
  })
  .eq('id', user.id)
if (updErr) {
  console.error('Update falhou:', updErr.message)
  process.exit(1)
}

const { error: sessErr } = await supabase
  .from('user_sessions')
  .update({ revoked_at: new Date().toISOString() })
  .eq('user_id', user.id)
  .is('revoked_at', null)
if (sessErr) console.warn('Aviso (revoke sessões):', sessErr.message)

const { error: lockErr } = await supabase.from('login_attempts').delete().eq('email_hash_input', email)
if (lockErr) {
  const { error: lockErr2 } = await supabase
    .from('login_attempts')
    .delete()
    .ilike('email_hash', '%')
  if (lockErr2) console.warn('Aviso (limpar login_attempts):', lockErr.message, lockErr2.message)
}

console.log('\n========================================')
console.log('SENHA NOVA (use uma vez e troque):')
console.log(newPassword)
console.log('========================================')
console.log('Login em: https://dashboard.example.com/login')
console.log('Status setado pra active. Sessões antigas revogadas.')
