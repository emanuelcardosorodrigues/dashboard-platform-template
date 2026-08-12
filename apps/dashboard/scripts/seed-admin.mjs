#!/usr/bin/env node
/**
 * Seed inicial Fase 2.3 — cria admin + viewer no banco.
 *
 * Uso:
 *   ADMIN_BOOTSTRAP_EMAIL=...                       \
 *   ADMIN_BOOTSTRAP_PASSWORD=...                    \
 *   VIEWER_BOOTSTRAP_EMAIL=admin@example.com  \
 *   VIEWER_BOOTSTRAP_PASSWORD=...                   \
 *   SUPABASE_URL=...                                \
 *   SUPABASE_SERVICE_ROLE_KEY=...                   \
 *   node scripts/seed-admin.mjs
 *
 * Idempotente: se o user já existe por email, atualiza senha. Status:
 *   admin → 'active'
 *   viewer → 'pending_onboarding' (Fase 3 vai forçar troca no 1º login).
 *
 * Após rodar uma vez em produção, remova ADMIN_BOOTSTRAP_* e DASHBOARD_PASSWORD
 * da Vercel.
 */
import { hash } from '@node-rs/argon2'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const must = (k) => {
  const v = process.env[k]
  if (!v) {
    console.error(`Missing env: ${k}`)
    process.exit(1)
  }
  return v
}

const supabase = createClient(must('SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, hashLength: 32 }

async function upsertUser({ email, password, role, status, name }) {
  const passwordHash = await hash(password, ARGON_OPTS)
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        role,
        status,
        name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    console.log(`updated ${role} ${email} (id=${existing.id})`)
    return existing.id
  }

  const id = randomUUID()
  const { error } = await supabase.from('users').insert({
    id,
    email,
    password_hash: passwordHash,
    role,
    status,
    name,
    ai_config: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.error(`insert failed for ${email}:`, error.message)
    process.exit(1)
  }
  console.log(`created ${role} ${email} (id=${id})`)
  return id
}

await upsertUser({
  email: must('ADMIN_BOOTSTRAP_EMAIL').toLowerCase(),
  password: must('ADMIN_BOOTSTRAP_PASSWORD'),
  role: 'admin',
  status: 'active',
  name: 'Admin',
})

const viewerEmail = process.env.VIEWER_BOOTSTRAP_EMAIL?.toLowerCase()
const viewerPassword = process.env.VIEWER_BOOTSTRAP_PASSWORD
if (viewerEmail && viewerPassword) {
  await upsertUser({
    email: viewerEmail,
    password: viewerPassword,
    role: 'viewer',
    status: 'pending_onboarding',
    name: 'Viewer',
  })
} else {
  console.log('(skip viewer — VIEWER_BOOTSTRAP_* não definidos)')
}

console.log('done.')
