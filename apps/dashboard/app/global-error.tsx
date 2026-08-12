'use client'

import { useEffect } from 'react'

export default function GlobalError({
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
    <html lang="pt-BR">
      <body style={{ margin: 0, backgroundColor: '#0A0F1E', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 400, width: '100%', margin: '0 24px', backgroundColor: '#111827', border: '1px solid #1F2937', borderRadius: 12, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 20 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: '#fff' }}>Algo deu errado</h2>
            <p style={{ margin: 0, fontSize: 14, color: '#9CA3AF' }}>
              Ocorreu um erro crítico na aplicação. Tente recarregar a página.
            </p>
          </div>
          <button
            onClick={() => unstable_retry()}
            style={{ width: '100%', borderRadius: 8, backgroundColor: '#06B6D4', border: 'none', color: '#fff', fontSize: 14, fontWeight: 500, padding: '10px 16px', cursor: 'pointer' }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  )
}
