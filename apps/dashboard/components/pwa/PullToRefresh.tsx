'use client'

/**
 * E5 — Wrapper CLIENT de pull-to-refresh em volta do {children} do <main>.
 *
 * Por que um wrapper e não virar o layout inteiro em client: o layout é um server
 * component que já libera o shell e faz streaming do Sidebar/banner/página via
 * <Suspense>. Aqui `children` chega como PROP (já renderizado no servidor) e é só
 * repassado — então continua sendo server component, continua fazendo streaming, e
 * os <Suspense> de dentro das páginas seguem funcionando. Este componente client
 * só re-renderiza a si mesmo (estado do gesto); `children` é a mesma referência,
 * então não re-renderiza junto.
 *
 * Desktop: o wrapper é `display:contents` (caixa nenhuma) → a página se comporta
 * EXATAMENTE como filha direta do <main>, layout idêntico ao de hoje, e nenhum
 * listener de toque é anexado. Só no mobile ele toma uma caixa `relative h-full`
 * (equivalente de layout à filha direta, já que as páginas são `h-full`) pra
 * ancorar o indicador — sem `transform` no wrapper, pra não criar containing block
 * e bagunçar `position:fixed` de modais das páginas.
 *
 * Refresh = `router.refresh()` (re-roda os fetches server-side das páginas — não há
 * SWR/react-query no app, então este É o revalidate) dentro de `useTransition`:
 * `isPending` fica verdadeiro até o RSC re-renderizar, o que dá o "carregando" de
 * graça. Um piso de ~600ms evita o spinner piscando em refresh instantâneo.
 */

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import { usePullToRefresh, type PullPhase } from '@/lib/hooks/usePullToRefresh'

const THRESHOLD = 72
const BADGE = 36 // diâmetro do indicador

function PullIndicator({ pull, phase, reduceMotion }: { pull: number; phase: PullPhase; reduceMotion: boolean }) {
  const progress = Math.min(1, pull / THRESHOLD)
  // pull=0 → escondido acima do topo; pull=threshold → repousa a ~12px do topo.
  const y = -(BADGE + 12) + Math.min(pull, THRESHOLD * 1.4) * ((BADGE + 24) / THRESHOLD)
  // Anima só no repouso/carregando (snap-back e hold); durante o arraste segue o
  // dedo 1:1. reduceMotion corta a animação (o globals.css já reforça isso).
  const animate = !reduceMotion && (phase === 'idle' || phase === 'refreshing')

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center">
      <div
        className={clsx(
          'flex items-center justify-center rounded-full bg-[#111827] border border-[#1F2937] shadow-lg text-purple-300',
          animate && 'transition-transform duration-300',
        )}
        style={{ width: BADGE, height: BADGE, transform: `translateY(${y}px)`, opacity: progress }}
      >
        {phase === 'refreshing' ? (
          <Loader2 size={18} className={reduceMotion ? undefined : 'animate-spin'} />
        ) : (
          <ArrowDown
            size={18}
            className={clsx('transition-transform', phase === 'ready' && !reduceMotion && 'rotate-180')}
          />
        )}
      </div>
    </div>
  )
}

export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [minHold, setMinHold] = useState(false)
  const refreshing = isPending || minHold

  const onRefresh = useCallback(() => {
    setMinHold(true)
    startTransition(() => {
      router.refresh()
    })
    window.setTimeout(() => setMinHold(false), 600)
  }, [router])

  const { rootRef, pull, phase, reduceMotion } = usePullToRefresh({
    onRefresh,
    refreshing,
    enabled: isMobile,
    threshold: THRESHOLD,
  })

  return (
    <div ref={rootRef} className={isMobile ? 'relative h-full' : 'contents'}>
      {isMobile && <PullIndicator pull={pull} phase={phase} reduceMotion={reduceMotion} />}
      {children}
    </div>
  )
}
