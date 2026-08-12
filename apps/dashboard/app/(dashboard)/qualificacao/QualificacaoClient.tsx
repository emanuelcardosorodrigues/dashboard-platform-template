'use client'

import { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import DataTable from '@/components/tables/DataTable'
import type { CompradoresQualificado, AlunoMentoria } from '@/types'
import { formatPercent } from '@/lib/formatters'
import { Users, UserCheck, UserMinus, Star } from 'lucide-react'

interface Stats {
  totalComFicha: number
  totalQualificados: number
  totalSemi: number
  totalLeads: number
  totalMentoria: number
}

interface DistRow extends Record<string, unknown> {
  criativo: string
  qualificados: number
  semi: number
  leads: number
  total: number
  pctQualificados: number
}

interface Props {
  compradores: CompradoresQualificado[]
  alunos: AlunoMentoria[]
  byCriativo: Record<string, { qualificados: number; semi: number; leads: number; total: number }>
  stats: Stats
  criativoLinks: Record<string, string>
}

export default function QualificacaoClient({ compradores, alunos, byCriativo, stats, criativoLinks }: Props) {
  const criativos = useMemo(() => {
    const seen = new Set(compradores.map((c) => c.criativo).filter(Boolean))
    return ['Todos', ...Array.from(seen).sort()]
  }, [compradores])

  const [selectedCriativo, setSelectedCriativo] = useState('Todos')

  const filteredCompradores = useMemo(
    () => selectedCriativo === 'Todos' ? compradores : compradores.filter((c) => c.criativo === selectedCriativo),
    [compradores, selectedCriativo]
  )
  const filteredAlunos = useMemo(
    () => selectedCriativo === 'Todos' ? alunos : alunos.filter((a) => a.criativo === selectedCriativo),
    [alunos, selectedCriativo]
  )

  const distRows: DistRow[] = Object.entries(byCriativo)
    .map(([criativo, data]) => ({
      criativo,
      ...data,
      pctQualificados: data.total > 0 ? (data.qualificados / data.total) * 100 : 0,
    }))
    .sort((a, b) => b.pctQualificados - a.pctQualificados)

  const statCards = [
    { label: 'Com Ficha', value: stats.totalComFicha, icon: Users, color: 'text-cyan-400' },
    { label: 'Qualificados', value: `${stats.totalQualificados} (${formatPercent((stats.totalQualificados / Math.max(stats.totalComFicha, 1)) * 100)})`, icon: UserCheck, color: 'text-emerald-400' },
    { label: 'Semi-qualificados', value: `${stats.totalSemi} (${formatPercent((stats.totalSemi / Math.max(stats.totalComFicha, 1)) * 100)})`, icon: UserMinus, color: 'text-amber-400' },
    { label: 'Leads', value: `${stats.totalLeads} (${formatPercent((stats.totalLeads / Math.max(stats.totalComFicha, 1)) * 100)})`, icon: UserMinus, color: 'text-gray-400' },
    { label: 'Programa de Aceleração', value: stats.totalMentoria, icon: Star, color: 'text-yellow-400' },
  ]

  const distColumns = [
    { key: 'criativo' as keyof DistRow, label: 'Criativo', sortable: true, render: (v: DistRow[keyof DistRow]) => <span className="text-white text-xs truncate max-w-48 block">{String(v)}</span> },
    { key: 'qualificados' as keyof DistRow, label: 'Qualificados', sortable: true, align: 'right' as const },
    { key: 'semi' as keyof DistRow, label: 'Semi', sortable: true, align: 'right' as const },
    { key: 'leads' as keyof DistRow, label: 'Leads', sortable: true, align: 'right' as const },
    { key: 'total' as keyof DistRow, label: 'Total', sortable: true, align: 'right' as const },
    {
      key: 'pctQualificados' as keyof DistRow,
      label: '% Qualif.',
      sortable: true,
      align: 'right' as const,
      render: (v: DistRow[keyof DistRow]) => (
        <span className={clsx('font-semibold', Number(v) >= 50 ? 'text-emerald-400' : Number(v) >= 30 ? 'text-amber-400' : 'text-rose-400')}>
          {formatPercent(Number(v))}
        </span>
      ),
    },
  ]

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
    username = username.replace(/^https?:\/\/(www\.)?instagram\.com\/?/, '').replace(/^@/, '').replace(/\/$/, '').trim()
    if (!username || username.includes(' ') || username.length < 2) return null
    return `https://instagram.com/${username}`
  }

  type AlunoRow = AlunoMentoria & Record<string, unknown>
  const alunoColumns = [
    { key: 'nome' as keyof AlunoRow, label: 'Nome', sortable: true, render: (v: AlunoRow[keyof AlunoRow]) => <span className="text-white">{String(v)}</span> },
    { key: 'email' as keyof AlunoRow, label: 'Email', render: (v: AlunoRow[keyof AlunoRow]) => <span className="text-gray-400 text-xs">{String(v)}</span> },
    { key: 'criativo' as keyof AlunoRow, label: 'Criativo de Origem', sortable: true, render: (v: AlunoRow[keyof AlunoRow]) => <span className="text-cyan-400 text-xs">{String(v)}</span> },
    { key: 'qualificacao' as keyof AlunoRow, label: 'Qualificação' },
    {
      key: 'whatsapp' as keyof AlunoRow,
      label: 'WhatsApp',
      render: (v: AlunoRow[keyof AlunoRow]) => {
        const href = toWhatsAppHref(v as string | undefined)
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-[#25D366] hover:text-[#25D366]/80 text-xs flex items-center gap-1 transition-colors">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {String(v || '')}
          </a>
        ) : <span className="text-gray-400 text-xs">{String(v || '–')}</span>
      }
    },
    {
      key: 'instagram' as keyof AlunoRow,
      label: 'Instagram',
      render: (v: AlunoRow[keyof AlunoRow]) => {
        const href = toInstagramHref(v as string | undefined)
        return href ? (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className="text-[#E1306C] hover:text-[#E1306C]/80 text-xs flex items-center gap-1 transition-colors">
            <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
            </svg>
            {String(v || '')}
          </a>
        ) : <span className="text-gray-400 text-xs">–</span>
      }
    },
    { key: 'faturamentoDeclarado' as keyof AlunoRow, label: 'Faturamento Declarado' },
    { key: 'especialidade' as keyof AlunoRow, label: 'Especialidade' },
  ]

  const link = selectedCriativo !== 'Todos' ? criativoLinks[selectedCriativo] : undefined

  const filteredQual = filteredCompradores.filter((c) => c.qualificacao === 'Qualificado').length
  const filteredSemi = filteredCompradores.filter((c) => c.qualificacao === 'Semi-qualificado').length
  const filteredLeads = filteredCompradores.filter((c) => c.qualificacao === 'Lead').length

  const activeStats = selectedCriativo === 'Todos' ? statCards : [
    { label: 'Com Ficha', value: filteredCompradores.length, icon: Users, color: 'text-cyan-400' },
    { label: 'Qualificados', value: `${filteredQual} (${formatPercent((filteredQual / Math.max(filteredCompradores.length, 1)) * 100)})`, icon: UserCheck, color: 'text-emerald-400' },
    { label: 'Semi-qualificados', value: `${filteredSemi} (${formatPercent((filteredSemi / Math.max(filteredCompradores.length, 1)) * 100)})`, icon: UserMinus, color: 'text-amber-400' },
    { label: 'Leads', value: `${filteredLeads} (${formatPercent((filteredLeads / Math.max(filteredCompradores.length, 1)) * 100)})`, icon: UserMinus, color: 'text-gray-400' },
    { label: 'Programa de Aceleração', value: filteredCompradores.filter((c) => c.alunoMentoria).length, icon: Star, color: 'text-yellow-400' },
  ]

  type CompradorRow = CompradoresQualificado & Record<string, unknown>
  const compradorColumns = [
    { key: 'nome' as keyof CompradorRow, label: 'Nome', sortable: true, render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-white">{String(v)}</span> },
    {
      key: 'qualificacao' as keyof CompradorRow, label: 'Qualificação', sortable: true,
      render: (v: CompradorRow[keyof CompradorRow]) => (
        <span className={clsx('text-xs font-semibold', String(v) === 'Qualificado' ? 'text-emerald-400' : String(v) === 'Semi-qualificado' ? 'text-amber-400' : 'text-gray-400')}>
          {String(v)}
        </span>
      )
    },
    { key: 'faturamentoDeclarado' as keyof CompradorRow, label: 'Faturamento', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-gray-400 text-xs">{String(v)}</span> },
    { key: 'especialidade' as keyof CompradorRow, label: 'Especialidade', render: (v: CompradorRow[keyof CompradorRow]) => <span className="text-gray-400 text-xs">{String(v)}</span> },
  ]

  return (
    <div className="space-y-6">
      {/* Criativo selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <select
          value={selectedCriativo}
          onChange={(e) => setSelectedCriativo(e.target.value)}
          className="bg-[#111827] border border-[#1F2937] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500"
        >
          {criativos.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-sm rounded-lg hover:bg-cyan-500/20 transition-colors"
          >
            <ExternalLink size={14} />
            Ver criativo
          </a>
        )}
        {selectedCriativo !== 'Todos' && (
          <span className="text-gray-500 text-sm">{filteredCompradores.length} compradores</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {activeStats.map((s) => (
          <div key={s.label} className="bg-[#111827] border border-[#1F2937] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <s.icon size={16} className={s.color} />
              <span className="text-xs text-gray-400">{s.label}</span>
            </div>
            <p className={clsx('text-xl font-bold', s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filtered buyers table when criativo is selected */}
      {selectedCriativo !== 'Todos' && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937]">
            <h2 className="text-sm font-semibold text-white">Compradores — {selectedCriativo}</h2>
          </div>
          <DataTable columns={compradorColumns} data={filteredCompradores as CompradorRow[]} pageSize={20} rowKey={(_, i) => i} />
        </div>
      )}

      {/* Distribution by criativo */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#1F2937]">
          <h2 className="text-sm font-semibold text-white">Distribuição por Criativo</h2>
          <p className="text-xs text-gray-500 mt-0.5">Ordenado por % qualificados</p>
        </div>
        <DataTable columns={distColumns} data={distRows} pageSize={20} rowKey={(_, i) => i} />
      </div>

      {/* Stacked bar visualisation */}
      <div className="bg-[#111827] border border-[#1F2937] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Qualificação por Criativo (Top 10)</h2>
        <div className="space-y-3">
          {distRows.slice(0, 10).map((row) => {
            const total = row.total || 1
            const pQ = (row.qualificados / total) * 100
            const pS = (row.semi / total) * 100
            const pL = (row.leads / total) * 100
            return (
              <div key={row.criativo}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400 truncate max-w-xs">{row.criativo}</span>
                  <span className="text-xs text-gray-500 ml-2">{row.total}</span>
                </div>
                <div className="flex h-4 rounded-md overflow-hidden gap-px">
                  {pQ > 0 && <div style={{ width: `${pQ}%` }} className="bg-emerald-500" title={`Qualificados: ${formatPercent(pQ)}`} />}
                  {pS > 0 && <div style={{ width: `${pS}%` }} className="bg-amber-400" title={`Semi: ${formatPercent(pS)}`} />}
                  {pL > 0 && <div style={{ width: `${pL}%` }} className="bg-gray-600" title={`Leads: ${formatPercent(pL)}`} />}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-4 text-xs text-gray-500">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-500 rounded-sm" />Qualificados</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-400 rounded-sm" />Semi</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-gray-600 rounded-sm" />Leads</div>
        </div>
      </div>

      {/* Programa de Aceleracao */}
      {filteredAlunos.length > 0 && (
        <div className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1F2937] flex items-center gap-2">
            <Star size={16} className="text-yellow-400" />
            <h2 className="text-sm font-semibold text-white">Alunos do Programa de Aceleração ({filteredAlunos.length})</h2>
          </div>
          <DataTable columns={alunoColumns} data={filteredAlunos as AlunoRow[]} pageSize={20} rowKey={(_, i) => i} />
        </div>
      )}
    </div>
  )
}
