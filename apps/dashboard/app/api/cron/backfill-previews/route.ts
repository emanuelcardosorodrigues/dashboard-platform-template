/**
 * Backfill: busca preview links (Instagram permalink) para todos os ad_ids
 * que estão na tabela meta_ads mas ainda não têm preview_url.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const META_API = 'https://graph.facebook.com/v20.0'

export async function GET(req: NextRequest) {
  // CRON_SECRET obrigatório (bypass via x-vercel-cron). Mesmo padrão dos outros crons.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET
  if (!isVercelCron) {
    if (!cronSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'META_ACCESS_TOKEN não configurado' }, { status: 500 })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Busca todos os ad_ids distintos que ainda não têm preview_url
  const { data: rows, error } = await supabase
    .from('meta_ads')
    .select('ad_id')
    .is('preview_url', null)
    .not('ad_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const adIds = [...new Set((rows ?? []).map((r: { ad_id: string }) => r.ad_id).filter(Boolean))]

  if (adIds.length === 0) {
    return NextResponse.json({ msg: 'Nenhum ad_id sem preview_url', updated: 0 })
  }

  const previewMap: Record<string, string> = {}

  for (let i = 0; i < adIds.length; i += 50) {
    const batch = adIds.slice(i, i + 50)
    try {
      const url = `${META_API}/?ids=${batch.join(',')}&fields=preview_shareable_link,creative{instagram_permalink_url}&access_token=${token}`
      const res = await fetch(url)
      const json = await res.json() as Record<string, {
        preview_shareable_link?: string
        creative?: { instagram_permalink_url?: string }
        error?: { message: string }
      }>
      for (const [id, ad] of Object.entries(json)) {
        if (ad?.error) continue
        const link = ad?.creative?.instagram_permalink_url || ad?.preview_shareable_link
        if (link) previewMap[id] = link
      }
    } catch {
      console.warn(`[backfill] Erro no batch ${i}–${i + 50}`)
    }
  }

  // Atualiza cada ad_id com seu preview_url
  let updated = 0
  for (const [adId, url] of Object.entries(previewMap)) {
    const { error: upErr } = await supabase
      .from('meta_ads')
      .update({ preview_url: url })
      .eq('ad_id', adId)
      .is('preview_url', null)
    if (!upErr) updated++
  }

  return NextResponse.json({
    total_sem_link: adIds.length,
    encontrados_na_api: Object.keys(previewMap).length,
    updated,
  })
}
