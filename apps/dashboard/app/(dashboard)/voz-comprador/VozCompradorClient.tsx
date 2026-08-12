'use client'

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import DataTable from '@/components/tables/DataTable'
import type { CompradoresQualificado } from '@/types'
import { formatPercent } from '@/lib/formatters'
import { Filter, TrendingUp } from 'lucide-react'

interface FreqRow extends Record<string, unknown> {
  resposta: string
  frequencia: number
  pct: number
}

interface Props {
  compradores: CompradoresQualificado[]
}

// A página só gera 'Qualificado' ou 'Sem ficha' (ver VozCompradorPage) — 'Semi-qualificado'
// e 'Lead' são valores de OUTRA tela (qualificacao/) e nunca aparecem aqui.
type QualFilter = 'todos' | 'Qualificado'

// Normaliza para agrupamento: minúsculas, sem acentos, sem pontuação
function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

// Conta frequência agrupando case/acento equivalentes
function countFrequency(values: string[]): FreqRow[] {
  const groups: Record<string, { best: string; count: number }> = {}
  values.forEach((v) => {
    const raw = v?.trim()
    if (!raw) return
    const key = normalizeKey(raw)
    if (!key) return
    if (!groups[key]) groups[key] = { best: raw, count: 0 }
    groups[key].count++
    // Prefere a versão com primeira letra maiúscula (mais legível)
    const curr = groups[key].best
    const rawIsCapitalized = raw[0] === raw[0].toUpperCase() && raw[0] !== raw[0].toLowerCase()
    const currIsCapitalized = curr[0] === curr[0].toUpperCase() && curr[0] !== curr[0].toLowerCase()
    if (rawIsCapitalized && !currIsCapitalized) groups[key].best = raw
  })
  const total = values.filter((v) => v?.trim()).length || 1
  return Object.values(groups)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map(({ best, count }) => ({ resposta: best, frequencia: count, pct: (count / total) * 100 }))
}

function toWhatsAppHref(value?: string) {
  if (!value) return null
  let digits = value.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length < 10) return null
  const normalized = digits.startsWith('55') ? digits : `55${digits}`
  if (normalized.length < 12 || normalized.length > 13) return null
  return `https://wa.me/${normalized}`
}

function toInstagramHref(value?: string) {
  if (!value) return null
  let username = value.trim()
  if (!username) return null
  username = username.replace(/^https?:\/\/(www\.)?instagram\.com\/?/, '')
  username = username.replace(/^@/, '').replace(/\/$/, '').trim()
  if (!username || username.includes(' ') || username.length < 2) return null
  return `https://instagram.com/${username}`
}

// Ícone WhatsApp (SVG inline)
function WhatsAppIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

// Ícone Instagram (SVG inline)
function InstagramIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  )
}

export default function VozCompradorClient({ compradores }: Props) {
  const [qualFilter, setQualFilter] = useState<QualFilter>('todos')
  const [sexoFilter, setSexoFilter] = useState('todos')
  const [criaFilter, setCriaFilter] = useState('todos')
  const [fatFilter, setFatFilter] = useState('todos')
  const [searchText, setSearchText] = useState('')

  const uniqSexos = ['todos', ...Array.from(new Set(compradores.map((c) => c.sexo).filter(Boolean)))]
  const uniqCriativos = ['todos', ...Array.from(new Set(compradores.map((c) => c.criativo).filter(Boolean))).slice(0, 20)]
  const uniqFaturamentos = ['todos', ...Array.from(new Set(compradores.map((c) => c.faturamentoDeclarado).filter(Boolean))).sort()]

  const filtered = useMemo(() => {
    return compradores.filter((c) => {
      if (qualFilter !== 'todos' && c.qualificacao !== qualFilter) return false
      if (sexoFilter !== 'todos' && c.sexo !== sexoFilter) return false
      if (criaFilter !== 'todos' && c.criativo !== criaFilter) return false
      if (fatFilter !== 'todos' && c.faturamentoDeclarado !== fatFilter) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        const fields = [c.nome, c.maiorDificuldade, c.medos, c.objetivos, c.tentouAntes].join(' ').toLowerCase()
        if (!fields.includes(q)) return false
      }
      return true
    })
  }, [compradores, qualFilter, sexoFilter, criaFilter, fatFilter, searchText])

  const dores    = useMemo(() => countFrequency(filtered.flatMap((c) => (c.maiorDificuldade ?? '').split(',').map((v) => v.trim()).filter(Boolean))), [filtered])
  const medos    = useMemo(() => countFrequency(filtered.flatMap((c) => (c.medos ?? '').split(',').map((v) => v.trim()).filter(Boolean))), [filtered])
  const objetivos = useMemo(() => countFrequency(filtered.flatMap((c) => (c.objetivos ?? '').split(',').map((v) => v.trim()).filter(Boolean))), [filtered])

  type CompradorRow = CompradoresQualificado & Record<string, unknown>

  const columns = [
    {
      key: 'nome' as keyof CompradorRow,
      label: 'Nome',
      sortable: true,
      render: (v: CompradorRow[keyof CompradorRow], row: CompradorRow) => {
        const whatsappHref  = toWhatsAppHref(row.whatsapp as string | undefined)
        const instagramHref = toInstagramHref(row.instagram as string | undefined)
        return (
          <div className="flex items-center gap-2">
            <span className="text-white text-xs">{String(v)}</span>
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir WhatsApp"
                className="shrink-0 text-[#25D366] hover:text-[#25D366]/80 focus:outline-none transition-colors"
              >
                <WhatsAppIcon size={12} />
              </a>
            )}
            {instagramHref && (
              <a
                href={instagramHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Abrir Instagram"
                className="shrink-0 text-[#E1306C] hover:text-[#E1306C]/80 focus:outline-none transition-colors"
              >
                <InstagramIcon size={12} />
              </a>
            )}
          </div>
        )
      },
    },
    { key: 'criativo' as keyof CompradorRow, label: 'Criativo', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-cyan-400 text-xs truncate max-w-32 block">{String(v || '-')}</span> },
    {
      key: 'qualificacao' as keyof CompradorRow,
      label: 'Qualif.',
      render: (v: CompradorRow[keyof CompradorRow]) => {
        const q = String(v)
        return (
          <span className={clsx(
            'text-xs px-2 py-0.5 rounded-full',
            q === 'Qualificado'      ? 'bg-emerald-500/20 text-emerald-400' :
            q === 'Semi-qualificado' ? 'bg-amber-500/20 text-amber-400'     :
            'bg-gray-700 text-gray-400'
          )}>
            {q}
          </span>
        )
      },
    },
    { key: 'maiorDificuldade' as keyof CompradorRow, label: 'Maior Dificuldade', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-xs text-gray-300 max-w-48 block truncate" title={String(v || '')}>{String(v || '-')}</span> },
    { key: 'medos' as keyof CompradorRow, label: 'Medos', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-xs text-gray-300 max-w-48 block truncate" title={String(v || '')}>{String(v || '-')}</span> },
    { key: 'objetivos' as keyof CompradorRow, label: 'Objetivos', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-xs text-gray-300 max-w-48 block truncate" title={String(v || '')}>{String(v || '-')}</span> },
    { key: 'valorSonho' as keyof CompradorRow, label: 'Valor do Sonho', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-xs text-gray-300 max-w-32 block truncate" title={String(v || '')}>{String(v || '-')}</span> },
    { key: 'tentouAntes' as keyof CompradorRow, label: 'O que tentou', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-xs text-gray-300 max-w-32 block truncate" title={String(v || '')}>{String(v || '-')}</span> },
  ]

  const freqColumns = [
    { key: 'resposta' as keyof FreqRow, label: 'Resposta', render: (v: FreqRow[keyof FreqRow]) => <span className="text-gray-200 text-xs">{String(v)}</span> },
    { key: 'frequencia' as keyof FreqRow, label: 'Freq.', sortable: true, align: 'right' as const },
    {
      key: 'pct' as keyof FreqRow,
      label: '% Total',
      sortable: true,
      align: 'right' as const,
      render: (v: FreqRow[keyof FreqRow]) => (
        <div className="flex items-center justify-end gap-2">
          <div className="w-16 bg-[#1F2937] rounded-full h-1.5">
            <div className="h-1.5 bg-cyan-500 rounded-full" style={{ width: `${Math.min(Number(v), 100)}%` }} />
          </div>
          <span className="text-cyan-400 text-xs">{formatPercent(Number(v))}</span>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Filter size={14} />
          <span>Filtros:</span>
        </div>
        <input
          type="text"
          placeholder="Buscar por texto..."
          aria-label="Buscar por texto"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="px-3 py-1.5 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors duration-200"
        />
        <select value={qualFilter} onChange={(e) => setQualFilter(e.target.value as QualFilter)}
          aria-label="Filtrar por qualificação"
          className="px-3 py-1.5 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-gray-300 cursor-pointer focus:outline-none focus:border-cyan-500 transition-colors duration-200">
          <option value="todos">Todos os níveis</option>
          <option value="Qualificado">Qualificado</option>
        </select>
        <select value={sexoFilter} onChange={(e) => setSexoFilter(e.target.value)}
          aria-label="Filtrar por sexo"
          className="px-3 py-1.5 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-gray-300 cursor-pointer focus:outline-none focus:border-cyan-500 transition-colors duration-200">
          {uniqSexos.map((s) => <option key={s} value={s}>{s === 'todos' ? 'Todos os sexos' : s}</option>)}
        </select>
        <select value={criaFilter} onChange={(e) => setCriaFilter(e.target.value)}
          aria-label="Filtrar por criativo"
          className="px-3 py-1.5 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-gray-300 cursor-pointer focus:outline-none focus:border-cyan-500 transition-colors duration-200 max-w-48">
          {uniqCriativos.map((c) => <option key={c} value={c}>{c === 'todos' ? 'Todos os criativos' : c}</option>)}
        </select>
        <select value={fatFilter} onChange={(e) => setFatFilter(e.target.value)}
          aria-label="Filtrar por faturamento declarado"
          className="px-3 py-1.5 bg-[#1F2937] border border-[#374151] rounded-lg text-sm text-gray-300 cursor-pointer focus:outline-none focus:border-cyan-500 transition-colors duration-200 max-w-48">
          {uniqFaturamentos.map((f) => <option key={f} value={f}>{f === 'todos' ? 'Todos os faturamentos' : f}</option>)}
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} registros</span>
      </div>

      {/* Main table */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <DataTable columns={columns} data={filtered as CompradorRow[]} pageSize={20} rowKey={(_, i) => i} />
      </div>

      {/* Frequency tables */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
            <TrendingUp size={14} className="text-rose-400" />
            <h2 className="text-sm font-semibold text-white">Principais Dores</h2>
          </div>
          <DataTable columns={freqColumns} data={dores} pageSize={15} rowKey={(_, i) => i} />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
            <TrendingUp size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Principais Medos</h2>
          </div>
          <DataTable columns={freqColumns} data={medos} pageSize={15} rowKey={(_, i) => i} />
        </div>
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
            <TrendingUp size={14} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">Principais Objetivos</h2>
          </div>
          <DataTable columns={freqColumns} data={objetivos} pageSize={15} rowKey={(_, i) => i} />
        </div>
      </div>
    </div>
  )
}
