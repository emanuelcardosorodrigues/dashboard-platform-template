'use client'
import { useEffect } from 'react'
import { Printer } from 'lucide-react'

export default function PrintButton({ auto }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => window.print(), 800) // dá tempo da página pintar antes de imprimir
    return () => clearTimeout(t)
  }, [auto])
  return (
    <button onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 text-sm font-medium transition-colors cursor-pointer">
      <Printer size={16} /> Imprimir / Salvar PDF
    </button>
  )
}
