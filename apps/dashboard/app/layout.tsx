import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, DM_Sans } from 'next/font/google'
import './globals.css'
import RegisterSW from '@/components/pwa/RegisterSW'

const bricolage = Bricolage_Grotesque({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const dmSans = DM_Sans({
  variable: '--font-body',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

export const metadata: Metadata = {
  // Nome do produto — sempre exibido assim (título absoluto, sem sufixo de página).
  title: { absolute: 'Dashboard Analytics Hub' },
  description: 'Dashboard Analytics Hub — análise de vendas, criativos e conteúdo orgânico',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Analytics Hub' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#0A0F1E',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`${bricolage.variable} ${dmSans.variable} h-full`}>
      <body className="h-full bg-[#0A0F1E] font-[family-name:var(--font-body)]">
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
