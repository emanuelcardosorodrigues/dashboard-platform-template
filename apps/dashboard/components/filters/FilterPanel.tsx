'use client'

import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Trash2, X, SlidersHorizontal } from 'lucide-react'
import {
  type FilterState, type Rule, type Group, type Op, type FilterableColumn,
  OP_LABEL, NEEDS_VALUE, newRule, newGroup, makeId,
} from '@/lib/tableFilters'

const NUMERIC_OPS: Op[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between']
const BENCHMARK_OPS: Op[] = ['above_median', 'below_median', 'top_pct', 'bottom_pct']

interface Props {
  open: boolean
  onClose: () => void
  columns: FilterableColumn[]
  filter: FilterState
  setFilter: (next: FilterState) => void
}

export default function FilterPanel({ open, onClose, columns, filter, setFilter }: Props) {
  if (!open) return null

  const setGroups = (groups: Group[]) => setFilter({ groups })

  const addGroup = () => setGroups([...filter.groups, newGroup([newRule(columns[0].key)])])

  const removeGroup = (gid: string) => setGroups(filter.groups.filter((g) => g.id !== gid))

  const addRule = (gid: string) =>
    setGroups(filter.groups.map((g) =>
      g.id === gid ? { ...g, rules: [...g.rules, newRule(columns[0].key)] } : g
    ))

  const updateRule = (gid: string, rid: string, patch: Partial<Rule>) =>
    setGroups(filter.groups.map((g) =>
      g.id === gid ? { ...g, rules: g.rules.map((r) => r.id === rid ? { ...r, ...patch } : r) } : g
    ))

  const removeRule = (gid: string, rid: string) =>
    setGroups(filter.groups.map((g) =>
      g.id === gid ? { ...g, rules: g.rules.filter((r) => r.id !== rid) } : g
    ))

  const clearAll = () => setFilter({ groups: [] })

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="bg-[#0B1220] border border-[#1F2937] rounded-2xl p-5 w-full max-w-3xl shadow-2xl mt-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-cyan-400" />
            <h2 className="text-sm font-semibold text-white">Filtros avançados</h2>
            <span className="text-[10px] text-gray-500 bg-[#1F2937] px-2 py-0.5 rounded-full">
              {filter.groups.length} grupo{filter.groups.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {filter.groups.length > 0 && (
              <button onClick={clearAll} className="text-xs text-gray-400 hover:text-rose-400 cursor-pointer">
                Limpar tudo
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>

        <p className="text-[11px] text-gray-500 mb-4 leading-relaxed">
          Regras <strong className="text-gray-300">dentro de um grupo</strong> são combinadas com <strong className="text-cyan-400">E</strong>.
          Grupos <strong className="text-gray-300">entre si</strong> são combinados com <strong className="text-amber-400">OU</strong>.
        </p>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {filter.groups.map((g, idx) => (
            <div key={g.id} className="bg-[#111827] border border-[#1F2937] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  {idx === 0 ? 'Grupo' : <span className="text-amber-400">OU</span>}
                </span>
                <button onClick={() => removeGroup(g.id)} className="text-gray-500 hover:text-rose-400 cursor-pointer">
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="space-y-2">
                {g.rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    columns={columns}
                    onChange={(patch) => updateRule(g.id, r.id, patch)}
                    onRemove={() => removeRule(g.id, r.id)}
                  />
                ))}
              </div>

              <button
                onClick={() => addRule(g.id)}
                className="mt-2 flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                <Plus size={12} /> Adicionar regra (E)
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addGroup}
          className="mt-3 w-full py-2 text-xs text-amber-400 hover:text-amber-300 border border-dashed border-[#374151] hover:border-amber-400/50 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
        >
          <Plus size={12} /> {filter.groups.length === 0 ? 'Adicionar grupo' : 'Adicionar grupo OU'}
        </button>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 text-white rounded-lg cursor-pointer transition-colors"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleRow({
  rule, columns, onChange, onRemove,
}: {
  rule: Rule
  columns: FilterableColumn[]
  onChange: (patch: Partial<Rule>) => void
  onRemove: () => void
}) {
  const col = columns.find((c) => c.key === rule.column)
  const needs = NEEDS_VALUE[rule.op]

  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-[#1F2937]/40 rounded-lg p-1.5">
      {/* Coluna */}
      <select
        value={rule.column}
        onChange={(e) => onChange({ column: e.target.value })}
        className="bg-[#0B1220] border border-[#1F2937] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50 cursor-pointer min-w-32"
      >
        {columns.map((c) => (
          <option key={c.key} value={c.key}>{c.label}</option>
        ))}
      </select>

      {/* Operador */}
      <select
        value={rule.op}
        onChange={(e) => onChange({ op: e.target.value as Op })}
        className="bg-[#0B1220] border border-[#1F2937] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500/50 cursor-pointer"
      >
        <optgroup label="Numérico">
          {NUMERIC_OPS.map((op) => (
            <option key={op} value={op}>{OP_LABEL[op]}</option>
          ))}
        </optgroup>
        <optgroup label="Benchmark">
          {BENCHMARK_OPS.map((op) => (
            <option key={op} value={op}>{OP_LABEL[op]}</option>
          ))}
        </optgroup>
      </select>

      {/* Valor(es) */}
      {needs !== 'none' && (
        <ValueInput
          value={rule.value}
          onChange={(v) => onChange({ value: v })}
          kind={col?.kind}
          isPct={rule.op === 'top_pct' || rule.op === 'bottom_pct'}
        />
      )}
      {needs === 'two' && (
        <>
          <span className="text-[10px] text-gray-500">e</span>
          <ValueInput
            value={rule.value2 ?? 0}
            onChange={(v) => onChange({ value2: v })}
            kind={col?.kind}
          />
        </>
      )}

      {(rule.op === 'top_pct' || rule.op === 'bottom_pct') && (
        <span className="text-[10px] text-gray-500">%</span>
      )}

      <button onClick={onRemove} className="ml-auto text-gray-500 hover:text-rose-400 cursor-pointer">
        <X size={12} />
      </button>
    </div>
  )
}

function ValueInput({
  value, onChange, kind, isPct,
}: {
  value: number
  onChange: (v: number) => void
  kind?: 'currency' | 'percent' | 'number'
  isPct?: boolean
}) {
  const [local, setLocal] = useState(String(value))

  useEffect(() => {
    const parsed = parseFloat(local.replace('.', '').replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed !== value) setLocal(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="relative">
      {kind === 'currency' && !isPct && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500">R$</span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local.replace('.', '').replace(',', '.'))
          onChange(Number.isFinite(n) ? n : 0)
          if (!Number.isFinite(n)) setLocal('0')
        }}
        className={clsx(
          'bg-[#0B1220] border border-[#1F2937] rounded px-2 py-1 text-xs text-white w-20 focus:outline-none focus:border-cyan-500/50',
          kind === 'currency' && !isPct && 'pl-7'
        )}
      />
    </div>
  )
}
