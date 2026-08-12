import Link from 'next/link'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center min-h-[60vh] p-6">
      <div className="w-full max-w-md rounded-xl bg-[#111827] border border-[#1F2937] p-8 flex flex-col items-center text-center gap-5">
        <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Compass size={22} className="text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Página não encontrada</h2>
          <p className="text-sm text-gray-400">
            O item que você procura não existe mais ou o endereço está errado.
          </p>
        </div>
        <Link
          href="/visao-geral"
          className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium px-4 py-2.5 transition-colors"
        >
          Voltar à Visão Geral
        </Link>
      </div>
    </div>
  )
}
