export const dynamic = 'force-dynamic'

import Header from '@/components/layout/Header'
import NotasFiscaisClient from './NotasFiscaisClient'

export default function NotasFiscaisPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Notas Fiscais" subtitle="Configuração de produtos e percentuais de co-produção" />
      <div className="flex-1 overflow-y-auto p-6">
        <NotasFiscaisClient />
      </div>
    </div>
  )
}
