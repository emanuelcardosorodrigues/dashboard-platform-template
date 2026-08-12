'use client'

/**
 * Preferências do usuário logado, resolvidas no SERVIDOR (layout do dashboard) e
 * entregues aos client components por contexto.
 *
 * O valor chega como PROMESSA, não como string: o layout do dashboard não pode
 * dar `await` sem atrasar o 1º byte de toda página (é uma decisão explícita lá).
 * Quem consome resolve depois da hidratação — nenhum componente suspende por
 * causa disto, e a UI nunca fica esperando a preferência para desenhar.
 *
 * Fora do provider (páginas que não ficam sob o layout do dashboard) o hook
 * devolve `null` e o Header cai no fallback de localStorage, como antes.
 */

import { createContext, useContext } from 'react'

export interface UserPrefs {
  /** Rótulo do preset de período (ver lib/datePresets). `null` = nunca escolheu. */
  defaultPeriodoPromise: Promise<string | null> | null
}

const UserPrefsContext = createContext<UserPrefs>({ defaultPeriodoPromise: null })

export function UserPrefsProvider({
  defaultPeriodoPromise,
  children,
}: {
  defaultPeriodoPromise: Promise<string | null>
  children: React.ReactNode
}) {
  return (
    <UserPrefsContext.Provider value={{ defaultPeriodoPromise }}>
      {children}
    </UserPrefsContext.Provider>
  )
}

export function useUserPrefs(): UserPrefs {
  return useContext(UserPrefsContext)
}
