/**
 * Skeleton de página (Fase 1 — performance percebida).
 * Renderizado por loading.tsx durante a navegação entre abas/filtros, aparece
 * INSTANTÂNEO (antes do round-trip ao servidor terminar), eliminando a sensação
 * de "travado" ao trocar data/funil/aba. Espelha o shell (Header + conteúdo).
 *
 * E4 (plano mobile v2): há DOIS forks. O desktop (`hidden md:*`) é byte-a-byte o
 * skeleton antigo — nada muda em md+. O mobile (`md:hidden`) espelha o shell real
 * do celular: header compacto que quebra linha + cards EMPILHADOS (não uma grade
 * de 4). Um skeleton que não espelha o layout que vai chegar MENTE e piora a
 * percepção em vez de melhorar.
 */
export default function PageSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Carregando…">
      {/* ── Header placeholder ──────────────────────────────────────────── */}
      {/* Desktop: idêntico ao original (barra de 64px numa linha). */}
      <div className="hidden md:flex h-16 bg-[#0A0F1E] border-b border-[#1F2937] items-center justify-between px-6 shrink-0">
        <div className="h-5 w-44 rounded bg-[#1F2937] animate-pulse" />
        <div className="h-8 w-[26rem] max-w-[50vw] rounded-lg bg-[#111827] animate-pulse" />
      </div>
      {/* Mobile: espelha o Header real — título + fileira de filtros que quebra,
          com o pl-14 que reserva o canto do hambúrguer. */}
      <div className="md:hidden bg-[#0A0F1E] border-b border-[#1F2937] px-4 pl-14 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-3 shrink-0 space-y-2">
        <div className="h-5 w-40 rounded bg-[#1F2937] animate-pulse" />
        <div className="flex gap-2">
          <div className="h-7 w-24 rounded-lg bg-[#111827] animate-pulse" />
          <div className="h-7 flex-1 rounded-lg bg-[#111827] animate-pulse" />
        </div>
      </div>

      {/* ── Content placeholder ─────────────────────────────────────────── */}
      {/* Desktop: idêntico ao original (KPIs 2/4 col + gráfico grande). */}
      <div className="hidden md:block flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
          ))}
        </div>
        <div className="h-[28rem] rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
      </div>
      {/* Mobile: KPIs empilhados (o padrão da MobileHome) + gráfico curto.
          pb-bottom-nav garante que o último card não fica sob o bottom-nav. */}
      <div className="md:hidden flex-1 overflow-y-auto p-4 space-y-3 pb-bottom-nav">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[72px] rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
        ))}
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
          ))}
        </div>
        <div className="h-52 rounded-xl bg-[#111827] border border-[#1F2937] animate-pulse" />
      </div>
    </div>
  )
}
