'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LayoutDashboard, Sparkles, FlaskConical, Filter, LayoutGrid } from 'lucide-react'
import { clsx } from 'clsx'
import { useIsMobile, useMediaQuery } from '@/lib/hooks/useMediaQuery'
import MobileMoreSheet from './MobileMoreSheet'
import type { Role } from '@/lib/auth'

// Barra inferior só no mobile (< md). Desktop usa o rail lateral. Os 4 destinos
// escolhidos pelo dono + um 5º slot "Mais" (A1) que abre o sheet com a nav completa.
// A rota ativa acende em roxo.
const ITEMS = [
  { href: '/visao-geral', label: 'Geral', icon: LayoutDashboard },
  { href: '/criativos-ia', label: 'Criativos', icon: Sparkles },
  { href: '/experimentos', label: 'Experimentos', icon: FlaskConical },
  { href: '/funil', label: 'Funil', icon: Filter },
]

interface MobileBottomNavProps {
  /** allowed_paths do usuário, repassado ao sheet "Mais". Hoje o layout monta
   *  <MobileBottomNav/> sem props → `undefined` → o sheet mostra tudo (o gate é
   *  server-side). Para filtrar de fato, o coordenador pluga estes props a partir
   *  do SidebarSection (que já resolve role + allowedPaths). */
  allowedPaths?: readonly string[]
  role?: Role | null
}

export default function MobileBottomNav({ allowedPaths, role }: MobileBottomNavProps = {}) {
  const pathname = usePathname() ?? ''
  const [moreOpen, setMoreOpen] = useState(false)
  const [hidden, setHidden] = useState(false) // A3: minimizada no scroll-down
  const isMobile = useIsMobile()
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  // Navegar fecha o sheet "Mais" (a rota mudou → esconde o overlay).
  useEffect(() => { setMoreOpen(false) }, [pathname])

  // A3 — minimiza no scroll-down, reaparece no scroll-up. Só no mobile e só sem
  // `prefers-reduced-motion` (o movimento seria indesejado). É transform-only no
  // próprio <nav>: NÃO mexe em `--bottom-nav-h` nem em layout, então não briga
  // com o FAB da IA nem com nenhum outro `fixed bottom-*`. O scroller é o <main
  // overflow-y-auto> do layout, não a window.
  useEffect(() => {
    if (!isMobile || reduceMotion) return
    // Com o sheet aberto a barra fica visível (o scroll de fundo está travado).
    if (moreOpen) { setHidden(false); return }
    const scroller = document.querySelector('main')
    const getY = () => (scroller ? scroller.scrollTop : window.scrollY)
    let lastY = getY()
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = getY()
        if (y < 80) setHidden(false)             // perto do topo: sempre visível
        else if (y > lastY + 6) setHidden(true)  // descendo
        else if (y < lastY - 6) setHidden(false) // subindo
        lastY = y
        ticking = false
      })
    }
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [isMobile, reduceMotion, moreOpen])

  // "Mais" acende quando a rota atual NÃO é um dos 4 destinos primários.
  const onPrimary = ITEMS.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'))

  return (
    <>
      {/* A2/A5: `gap-2` (8dp M3) separa os alvos adjacentes e `px-2` afasta os das
          bordas laterais; sem isso alvos colados geram rage tap mesmo com tamanho ok.
          A altura já era ok (~55px) — a barra fica exatamente na `--bottom-nav-h`.
          A3: transform translateY(100%) desliza a barra pra fora no scroll-down. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex gap-2 px-2 bg-[#0F172A]/95 backdrop-blur border-t border-[#1F2937] transition-transform duration-300 ease-out"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: hidden ? 'translateY(100%)' : 'translateY(0)',
        }}
      >
        {ITEMS.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + '/')
          const Icon = it.icon
          return (
            <Link
              key={it.href}
              href={it.href}
              // F0.2 `--edge`: borda inferior é a região de pior precisão → alvo de 48px.
              className={clsx(
                'tap-target--edge flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors',
                active ? 'text-purple-300' : 'text-gray-500',
              )}
            >
              <Icon size={20} />
              {/* A5: rótulo sobe de text-[10px] pra 11px; trunca se estourar o slot. */}
              <span className="text-[11px] leading-none max-w-full truncate">{it.label}</span>
            </Link>
          )
        })}

        {/* 5º slot — "Mais" (A1): abre o sheet, nunca navega pra uma rota /mais. */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Mais seções"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={clsx(
            'tap-target--edge flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors',
            moreOpen || !onPrimary ? 'text-purple-300' : 'text-gray-500',
          )}
        >
          <LayoutGrid size={20} />
          <span className="text-[11px] leading-none max-w-full truncate">Mais</span>
        </button>
      </nav>

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        allowedPaths={allowedPaths}
        role={role}
      />
    </>
  )
}
