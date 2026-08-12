'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-1 items-center justify-center min-h-[60vh] p-6">
      <div className="w-full max-w-md rounded-xl bg-[#111827] border border-[#1F2937] p-8 flex flex-col items-center text-center gap-5">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <AlertTriangle size={22} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Algo deu errado</h2>
          <p className="text-sm text-gray-400">
            Ocorreu um erro inesperado. Tente novamente ou volte à visão geral.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <button
            onClick={() => unstable_retry()}
            className="flex-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-sm font-medium px-4 py-2.5 transition-colors cursor-pointer"
          >
            Tentar de novo
          </button>
          <Link
            href="/visao-geral"
            className="flex-1 rounded-lg border border-[#1F2937] hover:border-[#374151] text-gray-300 hover:text-white text-sm font-medium px-4 py-2.5 transition-colors text-center"
          >
            Voltar à Visão Geral
          </Link>
        </div>
      </div>
    </div>
  )
}
