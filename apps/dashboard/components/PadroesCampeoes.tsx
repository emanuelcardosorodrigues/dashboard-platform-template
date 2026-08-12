"use client";

import { useEffect, useState } from "react";
import { Trophy, ChevronDown, Loader2 } from "lucide-react";
import { mecanismoLabel } from "@/lib/taxonomia-demo";

interface CorteItem {
  valor: string;
  pct: number;
}
interface Cortes {
  hook_tipo: CorteItem[];
  estrutura_narrativa: CorteItem[];
  tom: CorteItem[];
  duracao_faixa: CorteItem[];
  nivel_consciencia: CorteItem[];
  momento_funil: CorteItem[];
}
interface PadroesResp {
  insuficiente?: boolean;
  total_criativos: number;
  top_performers: number;
  criterio?: string;
  cortes?: Cortes;
}

const CORTES: { key: keyof Cortes; label: string; mecanismo?: boolean }[] = [
  { key: "hook_tipo", label: "Mecanismo de gancho", mecanismo: true },
  { key: "nivel_consciencia", label: "Nível de consciência" },
  { key: "momento_funil", label: "Momento do funil" },
  { key: "tom", label: "Tom" },
  { key: "duracao_faixa", label: "Duração" },
  { key: "estrutura_narrativa", label: "Narrativa" },
];

/**
 * Painel "Padrões Campeões": o que os criativos de MAIOR ROAS (top 20%, p80)
 * têm em comum. Consome /api/criativos/padroes respeitando os filtros globais.
 * Colapsado por padrão (fetch lazy só ao abrir).
 */
export function PadroesCampeoes({
  de,
  ate,
  funil,
  conta,
}: {
  de: string;
  ate: string;
  funil: string;
  conta: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PadroesResp | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    setState("loading");
    const qs = new URLSearchParams();
    if (de) qs.set("de", de);
    if (ate) qs.set("ate", ate);
    if (funil && funil !== "all") qs.set("funil", funil);
    if (conta && conta !== "all") qs.set("conta", conta);
    let cancel = false;
    fetch(`/api/criativos/padroes?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: PadroesResp) => {
        if (!cancel) {
          setData(j);
          setState("idle");
        }
      })
      .catch(() => {
        if (!cancel) setState("error");
      });
    return () => {
      cancel = true;
    };
  }, [open, de, ate, funil, conta]);

  return (
    <div className="rounded-md border border-amber-500/25 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between w-full px-3 py-2"
      >
        <span className="flex items-center gap-2 text-[12px] font-semibold text-amber-200">
          <Trophy className="h-3.5 w-3.5" /> Padrões Campeões
          <span className="text-text-secondary font-normal">— o que os maiores ROAS têm em comum</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-3 pb-3">
          {state === "loading" && (
            <p className="flex items-center gap-2 text-text-secondary text-[12px] py-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> calculando padrões…
            </p>
          )}
          {state === "error" && <p className="text-amber-300 text-[12px] py-2">não foi possível calcular os padrões.</p>}
          {state === "idle" && data?.insuficiente && (
            <p className="text-text-secondary text-[12px] py-2">
              Dados insuficientes — precisa de ≥3 criativos com venda no período ({data.top_performers} encontrado
              {data.top_performers === 1 ? "" : "s"}).
            </p>
          )}
          {state === "idle" && data && !data.insuficiente && data.cortes && (
            <>
              <p className="text-[10px] text-text-secondary mb-2">
                {data.criterio} · {data.top_performers} de {data.total_criativos} criativos
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CORTES.map((c) => {
                  const items = data.cortes![c.key];
                  if (!items?.length) return null;
                  return (
                    <div key={c.key}>
                      <p className="text-[9px] uppercase tracking-wide text-text-secondary mb-1">{c.label}</p>
                      <div className="space-y-1">
                        {items.map((it, i) => (
                          <div key={`${it.valor}-${i}`} className="flex items-center gap-1.5">
                            <div className="flex-1 h-4 rounded bg-bg-base overflow-hidden relative">
                              <div className="h-full bg-amber-500/30" style={{ width: `${it.pct}%` }} />
                              <span className="absolute inset-0 px-1.5 flex items-center text-[10px] text-text-primary truncate">
                                {c.mecanismo ? mecanismoLabel(it.valor) : it.valor}
                              </span>
                            </div>
                            <span className="text-[10px] tabular-nums text-text-secondary w-8 text-right">{it.pct}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
