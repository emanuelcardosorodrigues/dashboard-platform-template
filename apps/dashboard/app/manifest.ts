import type { MetadataRoute } from 'next'

// PWA (A-F6) — servido em /manifest.webmanifest. Instalável na tela inicial,
// abre em standalone (sem barra do navegador), tema dark do dashboard.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dashboard Analytics Hub',
    short_name: 'Analytics Hub',
    description: 'Análise de vendas, criativos e conteúdo orgânico — Analytics Hub',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A0F1E',
    theme_color: '#0A0F1E',
    lang: 'pt-BR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
