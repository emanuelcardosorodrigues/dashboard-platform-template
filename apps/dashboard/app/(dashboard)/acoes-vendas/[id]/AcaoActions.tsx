'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

const STATUS = ['rascunho', 'ativo', 'encerrado']

export default function AcaoActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function setStatus(novo: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/acoes-vendas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: novo }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (e) { alert('Erro: ' + (e instanceof Error ? e.message : String(e))) } finally { setSaving(false) }
  }
  async function excluir() {
    if (!confirm('Excluir esta ação de vendas? (os dados de transações não são afetados)')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/acoes-vendas/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.push('/acoes-vendas')
      router.refresh()
    } catch (e) { alert('Erro: ' + (e instanceof Error ? e.message : String(e))); setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2">
      <select value={status} disabled={saving} onChange={(e) => setStatus(e.target.value)}
        className="bg-[#111827] border border-[#1F2937] rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer disabled:opacity-50">
        {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button onClick={excluir} disabled={saving} title="Excluir ação"
        className="p-2 rounded-lg border border-[#1F2937] text-gray-500 hover:text-rose-400 hover:border-rose-500/40 transition-colors cursor-pointer disabled:opacity-50">
        <Trash2 size={15} />
      </button>
    </div>
  )
}
