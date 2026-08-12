'use client'

import { useEffect, useState } from 'react'

export interface FunilOpt { label: string; value: string; cor?: string | null }

// Fallback = os 4 funis canônicos (idêntico ao hard-coded antigo), usado enquanto
// /api/funis não respondeu ou se a tabela estiver vazia.
const FALLBACK: FunilOpt[] = [
  { label: 'Todos', value: 'all' },
  { label: 'COL', value: 'col' },
  { label: 'DPL', value: 'dpl' },
  { label: 'LPS', value: 'lps' },
  { label: 'PLO', value: 'plo' },
]

// Cache em memória (módulo) p/ não refazer fetch a cada navegação de aba.
let cache: FunilOpt[] | null = null

/** Opções de funil pros dropdowns, vindas da config do admin (com 'Todos' na frente). */
export function useFunilOptions(): FunilOpt[] {
  const [opts, setOpts] = useState<FunilOpt[]>(cache ?? FALLBACK)
  useEffect(() => {
    if (cache) return
    let vivo = true
    fetch('/api/funis')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Array<{ slug: string; nome: string; cor?: string | null }> | null) => {
        if (!vivo || !Array.isArray(data) || data.length === 0) return
        const mapped: FunilOpt[] = [
          { label: 'Todos', value: 'all' },
          ...data.map((f) => ({ label: f.nome, value: f.slug, cor: f.cor })),
        ]
        cache = mapped
        setOpts(mapped)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [])
  return opts
}
