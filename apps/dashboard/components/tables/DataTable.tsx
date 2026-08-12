'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { clsx } from 'clsx'
import ColumnHeaderInfo from './ColumnHeaderInfo'

interface Column<T> {
  key: keyof T
  label: string
  tooltip?: string
  /** Texto do botão de ajuda (i) no cabeçalho — explica como a métrica é calculada. */
  info?: string
  sortable?: boolean
  align?: 'left' | 'center' | 'right'
  /** Largura padrão (px). Quando QUALQUER coluna define width, a tabela usa
   *  table-layout fixed e toda coluna nasce visível nessa largura (override por resize). */
  width?: number
  render?: (value: T[keyof T], row: T) => React.ReactNode
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[]
  data: T[]
  pageSize?: number
  className?: string
  rowKey?: (row: T, index: number) => string | number
  /** Namespace pra persistir larguras de coluna (resize) no localStorage. */
  storageKey?: string
}

type SortDir = 'asc' | 'desc' | null
const MIN_W = 64
const MAX_W = 480
const DEFAULT_COL_W = 120 // fallback quando a tabela usa larguras mas a coluna não definiu uma

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  pageSize = 20,
  className,
  rowKey,
  storageKey,
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<keyof T | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [page, setPage] = useState(1)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const drag = useRef<{ key: string } | null>(null)

  // Reset to page 1 when data changes (e.g. after filter/search)
  useEffect(() => { setPage(1) }, [data])

  // Larguras salvas (resize). Só ativa table-layout fixed quando há alguma largura.
  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(`dt-widths:${storageKey}`)
      if (raw) setWidths(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [storageKey])

  const persist = useCallback((w: Record<string, number>) => {
    if (!storageKey) return
    try { localStorage.setItem(`dt-widths:${storageKey}`, JSON.stringify(w)) } catch { /* ignore */ }
  }, [storageKey])

  // Mede as larguras atuais de TODAS as colunas — usado pra "congelar" o layout
  // antes de mudar pra fixed (a coluna arrastada muda; as demais ficam idênticas).
  const measureAll = useCallback((): Record<string, number> => {
    const out: Record<string, number> = {}
    theadRef.current?.querySelectorAll<HTMLTableCellElement>('th[data-col]')
      .forEach((th) => { if (th.dataset.col) out[th.dataset.col] = Math.round(th.getBoundingClientRect().width) })
    return out
  }, [])

  const onResizeStart = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault(); e.stopPropagation()
    const base = Object.keys(widths).length ? { ...widths } : measureAll()
    const startX = e.clientX
    const startW = base[key] ?? MIN_W
    drag.current = { key }
    setWidths(base)
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW + (ev.clientX - startX)))
      setWidths((prev) => ({ ...prev, [key]: next }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      drag.current = null
      setWidths((prev) => { persist(prev); return prev })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [widths, measureAll, persist])

  const resetWidth = useCallback((key: string) => {
    setWidths((prev) => { const n = { ...prev }; delete n[key]; persist(n); return n })
  }, [persist])

  // Larguras padrão das colunas (ex.: tabelas de métricas) ligam o modo fixo
  // mesmo sem o usuário ter redimensionado nada → colunas adicionadas já nascem
  // visíveis. Override por coluna vem do `widths` (resize salvo).
  const hasColDefaults = columns.some((c) => c.width != null)
  const hasWidths = Object.keys(widths).length > 0 || hasColDefaults
  const effWidth = (col: Column<T>): number | undefined =>
    widths[String(col.key)] ?? col.width ?? (hasWidths ? DEFAULT_COL_W : undefined)

  const handleSort = (col: keyof T) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
      if (sortDir === 'desc') setSortCol(null)
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
    setPage(1)
  }

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return data
    return [...data].sort((a, b) => {
      const va = a[sortCol]
      const vb = b[sortCol]
      const numA = typeof va === 'number' ? va : parseFloat(String(va) || '0')
      const numB = typeof vb === 'number' ? vb : parseFloat(String(vb) || '0')
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === 'asc' ? numA - numB : numB - numA
      }
      const strA = String(va ?? '').toLowerCase()
      const strB = String(vb ?? '').toLowerCase()
      return sortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA)
    })
  }, [data, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const SortIcon = ({ col }: { col: keyof T }) => {
    if (sortCol !== col) return <ChevronsUpDown size={12} className="text-gray-400" />
    if (sortDir === 'asc') return <ChevronUp size={12} className="text-cyan-400" />
    return <ChevronDown size={12} className="text-cyan-400" />
  }

  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full text-sm" style={hasWidths ? { tableLayout: 'fixed' } : undefined}>
        {hasWidths && (
          <colgroup>
            {columns.map((col) => {
              const w = effWidth(col)
              return <col key={String(col.key)} style={w ? { width: w } : undefined} />
            })}
          </colgroup>
        )}
        <thead ref={theadRef}>
          <tr className="border-b border-[#1F2937]">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                data-col={String(col.key)}
                title={col.tooltip}
                className={clsx(
                  'relative px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap',
                  col.tooltip && 'cursor-help',
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                  col.sortable && 'cursor-pointer hover:text-white select-none transition-colors duration-200'
                )}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <div
                  className={clsx(
                    'flex items-center gap-1 overflow-hidden',
                    col.align === 'right' && 'justify-end',
                    col.align === 'center' && 'justify-center'
                  )}
                >
                  {col.label}
                  {col.sortable && <SortIcon col={col.key} />}
                  {col.info && <ColumnHeaderInfo text={col.info} />}
                </div>
                {/* Alça de redimensionamento (borda direita): zona de arraste larga
                    com uma barra vertical visível de baixa opacidade indicando onde puxar. */}
                <span
                  onMouseDown={(e) => onResizeStart(e, String(col.key))}
                  onDoubleClick={(e) => { e.stopPropagation(); resetWidth(String(col.key)) }}
                  onClick={(e) => e.stopPropagation()}
                  title="Arraste para redimensionar · duplo-clique reseta"
                  className="group/resize absolute right-0 top-0 h-full w-2 cursor-col-resize select-none flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="h-1/2 w-px bg-gray-500/40 transition-all duration-150 group-hover/resize:bg-cyan-400 group-hover/resize:w-0.5 group-hover/resize:h-3/4" />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginated.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className="border-b border-[#1F2937] hover:bg-[#1F2937]/50 transition-colors duration-150"
            >
              {columns.map((col) => (
                <td
                  key={String(col.key)}
                  className={clsx(
                    'px-4 py-3 text-gray-300',
                    hasWidths && 'overflow-hidden text-ellipsis whitespace-nowrap',
                    col.align === 'right' ? 'text-right tabular-nums' : col.align === 'center' ? 'text-center' : 'text-left'
                  )}
                >
                  {col.render
                    ? col.render(row[col.key], row)
                    : String(row[col.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
          {paginated.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-400">
                Sem dados disponíveis
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#1F2937]">
          <p className="text-xs text-gray-500">
            {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} de {sorted.length} registros
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage === 1}
              className="px-2 py-1 text-xs rounded bg-[#1F2937] text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors duration-200"
            >
              Anterior
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = Math.max(1, Math.min(safePage - 2, totalPages - 4)) + i
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={clsx(
                    'w-7 h-7 text-xs rounded transition-colors duration-200 cursor-pointer',
                    p === safePage ? 'bg-cyan-500 text-white' : 'bg-[#1F2937] text-gray-400 hover:text-white'
                  )}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage === totalPages}
              className="px-2 py-1 text-xs rounded bg-[#1F2937] text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors duration-200"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
