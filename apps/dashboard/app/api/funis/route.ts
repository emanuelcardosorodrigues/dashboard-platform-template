/**
 * GET /api/funis — lista os funis ativos do workspace (slug, nome, cor) p/ os
 * dropdowns dinâmicos (Header / FilterToggle). Fallback gracioso: erro → [].
 */
import { NextResponse } from 'next/server'
import { fetchFunisConfig } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const funis = await fetchFunisConfig()
    return NextResponse.json(
      funis
        .filter((f) => f.ativo !== false)
        .sort((a, b) => a.ordem - b.ordem)
        .map((f) => ({ slug: f.slug, nome: f.nome, cor: f.cor ?? null })),
    )
  } catch {
    return NextResponse.json([])
  }
}
