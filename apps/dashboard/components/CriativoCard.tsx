"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { type CriativoCard as CriativoCardType, type FadigaStatus, type CriativoTag } from "@/types/criativos";
import { FileVideo, Maximize2, ExternalLink, X, Copy, Check } from "lucide-react";
import { MetricTrendChart } from "./MetricTrendChart";
import { formatoLabel, mecanismoLabel } from "@/lib/taxonomia-demo";
import { TagAdder } from "./criativos/TagAdder";
import { CriativoModal } from "./criativos/CriativoModal";

// ---------- cores / benchmarks ----------

const FADIGA_COLORS: Record<FadigaStatus, string> = {
  saudavel: "#10b981",
  atencao: "#eab308",
  saturado: "#ef4444",
  insuficiente: "#6b7280",
};

const FADIGA_LABELS: Record<FadigaStatus, string> = {
  saudavel: "🟢 Saudável",
  atencao: "🟡 Atenção",
  saturado: "🔴 Saturado",
  insuficiente: "Dados insuficientes",
};

const COLOR = { green: "#10b981", yellow: "#eab308", red: "#ef4444", gray: "#6b7280" } as const;
type Sinal = keyof typeof COLOR;

// Configuração das barras de métrica. Hook/Hold usam os benchmarks do Homero
// Pirro (sobre impressões); os demais usam thresholds heurísticos a calibrar.
// `lowerBetter` inverte (menor valor = melhor). `scale` só define o preenchimento visual.
export type MetricKey =
  | "cpm" | "ctr" | "hook_rate" | "hold_rate" | "cpc_link" | "roas"
  | "cpa" | "custo_por_checkout"
  | "conv_body" | "conv_clique" | "comentarios"
  | "receita" | "lucro" | "vendas" | "investimento" | "impressoes";
interface BarCfg {
  label: string;
  fmt: (v: number) => string;
  scale: number;
  green: number;
  yellow: number;
  lowerBetter?: boolean;
}
const BAR: Record<MetricKey, BarCfg> = {
  // Pirro: hook ≥50% verde · ≥35% amarelo · <35% vermelho
  hook_rate: { label: "Hook Rate", fmt: (v) => pct(v), scale: 0.6, green: 0.5, yellow: 0.35 },
  // Pirro: hold ≥3% verde · ≥2% amarelo · <2% vermelho
  hold_rate: { label: "Hold Rate", fmt: (v) => pct(v), scale: 0.06, green: 0.03, yellow: 0.02 },
  ctr: { label: "CTR", fmt: (v) => pct(v), scale: 0.05, green: 0.02, yellow: 0.013 },
  cpm: { label: "CPM", fmt: (v) => brl(v), scale: 60, green: 30, yellow: 45, lowerBetter: true },
  cpc_link: { label: "CPC Link", fmt: (v) => brl(v), scale: 6, green: 2, yellow: 4, lowerBetter: true },
  roas: { label: "ROAS", fmt: (v) => `${v.toFixed(2)}x`, scale: 3, green: 2, yellow: 1 },
  cpa: { label: "CPA", fmt: (v) => brl(v), scale: 1500, green: 300, yellow: 700, lowerBetter: true },
  custo_por_checkout: { label: "Custo/Checkout", fmt: (v) => brl(v), scale: 300, green: 50, yellow: 150, lowerBetter: true },
  // Conv. Body: vendas ÷ views 75%. Mede o MIOLO do criativo — de quem aguentou até o fim,
  // quantos compraram. (O gancho já é medido pelo hook rate.) Cortes calibrados na conta:
  // média dos últimos 30d ≈ 2,1%; o melhor criativo (react_ugc-laila) bate 4,5%.
  conv_body: { label: "Conv. Body", fmt: (v) => pct(v), scale: 0.08, green: 0.04, yellow: 0.02 },
  // Conv. Clique: vendas ÷ cliques no link. Mede tudo DEPOIS do anúncio (página + checkout).
  // Média da conta ≈ 3,0%; melhor criativo ≈ 7,7%.
  conv_clique: { label: "Conv. Clique", fmt: (v) => pct(v), scale: 0.1, green: 0.05, yellow: 0.025 },
  // Volume de comentários (engajamento), NÃO sentimento — comentário negativo conta igual.
  // Pra ler o teor, use a extração de comentários (meta_comments tem sentimento/objeção).
  comentarios: { label: "Comentários", fmt: (v) => String(Math.round(v)), scale: 20, green: 5, yellow: 1 },
  receita: { label: "Receita", fmt: (v) => brl(v), scale: 10000, green: 5000, yellow: 2000 },
  lucro: { label: "Lucro", fmt: (v) => brl(v), scale: 5000, green: 2000, yellow: 0 },
  vendas: { label: "Vendas", fmt: (v) => String(Math.round(v)), scale: 10, green: 5, yellow: 2 },
  investimento: { label: "Gasto", fmt: (v) => brl(v), scale: 5000, green: 5000, yellow: 2000 },
  impressoes: { label: "Impressões", fmt: (v) => compact(v), scale: 100000, green: 50000, yellow: 20000 },
};

function sinalFor(key: MetricKey, v: number | null): Sinal {
  if (v === null || !Number.isFinite(v)) return "gray";
  const c = BAR[key];
  if (c.lowerBetter) {
    if (v <= c.green) return "green";
    if (v <= c.yellow) return "yellow";
    return "red";
  }
  if (v >= c.green) return "green";
  if (v >= c.yellow) return "yellow";
  return "red";
}

// ---------- formatadores ----------

function pct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}
function brl(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function compact(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}
function roasFmt(v: number): string {
  return `${v.toFixed(2)}x`;
}

// frames_path vem como JSON string do worker da VPS: [{cat,url}, ...]
type Frame = { cat: string; url: string };
function parseFrames(raw: string | null): Frame[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr.filter((f): f is Frame => !!f && typeof f.url === "string" && f.url.trim() !== "");
    }
  } catch {
    /* ignora json malformado */
  }
  return [];
}

interface TrendResp {
  history: Array<{ day: string; value: number | null }>;
  projection: Array<{ day: string; value: number | null }>;
  meta?: {
    basis: "historico" | "agregado-janela" | "agregado-vida" | "sem-dados";
    activeDays: number;
    windowFrom: string | null;
    windowTo: string | null;
    stale: boolean;
    confidence: number;
  };
}

const BASIS_LABEL: Record<string, string> = {
  historico: "proj. pela tendência",
  "agregado-janela": "proj. pelo agregado da janela",
  "agregado-vida": "proj. pelo agregado histórico",
};
const dm = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// Default do rodapé do card (design VK Metrics): as 4 métricas que leem o funil
// do criativo ponta a ponta — gancho (Hook), miolo (Body Conversion), custo do
// clique (CPC link) e retenção (Hold). Todas já definidas em BAR acima.
export const DEFAULT_BARS: MetricKey[] = ["hook_rate", "conv_body", "cpc_link", "hold_rate"];

export const METRIC_OPTIONS: { key: MetricKey; label: string }[] = (Object.keys(BAR) as MetricKey[]).map((k) => ({
  key: k,
  label: BAR[k].label,
}));

export function CriativoCard({
  criativo,
  bars = DEFAULT_BARS,
  selectable = false,
  selected = false,
  onToggleSelect,
  priority = false,
}: {
  criativo: CriativoCardType;
  bars?: MetricKey[];
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** true nos primeiros cards (acima da dobra): thumb eager + fetchPriority alto — é o LCP da tela. */
  priority?: boolean;
}) {
  // Rede de segurança: se a prévia não carregar (URL de terceiro que venceu), a
  // imagem quebrada mostraria o alt text cru. Cai no mesmo placeholder de "sem
  // thumbnail" — falha feia vira falha silenciosa e legível.
  const [thumbQuebrada, setThumbQuebrada] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false); // popup A-F3 (clique no nome)
  const [copied, setCopied] = useState(false); // feedback do "Copiar ID"
  const [localTags, setLocalTags] = useState<CriativoTag[]>([]); // tags adicionadas otimisticamente nesta sessão
  // exibidas = servidor (criativo.tags, atualiza no router.refresh) ∪ otimistas, dedup por id
  const shownTags = useMemo(() => {
    const seen = new Set<number>();
    const out: CriativoTag[] = [];
    for (const t of [...(criativo.tags ?? []), ...localTags]) if (!seen.has(t.id)) { seen.add(t.id); out.push(t); }
    return out;
  }, [criativo.tags, localTags]);
  const [detailTab, setDetailTab] = useState<"resumo" | "transcricao">("resumo");
  const [lightbox, setLightbox] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null); // frame específico no zoom
  const [trend, setTrend] = useState<TrendResp | null>(null);
  const [trendState, setTrendState] = useState<"idle" | "loading" | "error">("idle");

  const fadiga: FadigaStatus = criativo.fadiga_status ?? "insuficiente";
  const borderColor = FADIGA_COLORS[fadiga];
  const frames = parseFrames(criativo.frames_path);
  // Link "ver anúncio": IG permalink quando houver, senão o preview do Meta
  // (mesma fonte da aba Criativos — cobertura ampla).
  const anuncioUrl = criativo.instagram_permalink_url || criativo.preview_url;
  const anuncioLabel = anuncioUrl && /instagram\.com/.test(anuncioUrl) ? "Ver no Instagram" : "Ver anúncio";
  const resumo = criativo.resumo;
  const transcricao = criativo.transcricao;
  const hookDescricao = criativo.hook_descricao;
  const roasSinal = sinalFor("roas", criativo.roas);

  // tags do topo: ângulo (nível consciência / momento funil) + formato (hook_tipo)
  const tags: string[] = [];
  if (criativo.hook_tipo) tags.push(...criativo.hook_tipo.slice(0, 2).map(mecanismoLabel));
  if (criativo.momento_funil) tags.push(criativo.momento_funil);

  useEffect(() => {
    if (!expanded || trend || trendState !== "idle") return;
    setTrendState("loading");
    fetch(`/api/criativos/tendencia?ad_id=${encodeURIComponent(criativo.ad_id)}&metrica=hold_rate`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((j: TrendResp) => {
        setTrend(j);
        setTrendState("idle");
      })
      .catch(() => setTrendState("error"));
  }, [expanded, trend, trendState, criativo.ad_id]);

  return (
    <div
      className={`group flex flex-col border bg-surface overflow-hidden rounded-md ${selected ? "border-purple-500 ring-2 ring-purple-500/40" : "border-border"}`}
      style={{ borderTop: `3px solid ${borderColor}` }}
    >
      {modalOpen && <CriativoModal criativo={criativo} onClose={() => setModalOpen(false)} />}
      {/* ===== Thumbnail ===== */}
      <div className="relative aspect-[4/3] bg-bg-base/60 overflow-hidden">
        {selectable && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
            title={selected ? "Desmarcar" : "Selecionar"}
            className={`absolute top-2 left-2 z-20 h-5 w-5 rounded border flex items-center justify-center transition-opacity ${
              selected ? "bg-purple-500 border-purple-500 opacity-100" : "bg-black/50 border-white/40 text-white/80 opacity-0 group-hover:opacity-100"
            }`}
          >
            {selected && <Check className="h-3 w-3 text-white" />}
          </button>
        )}
        {criativo.thumbnail_url && !thumbQuebrada ? (
          // PERF: esta thumb é o elemento LCP do /criativos-ia (medido 2,8s no
          // desktop). Com next/image o Vercel serve WebP redimensionado pro
          // tamanho real do card — vale pras imagens JÁ existentes (as originais
          // pesam 58-204KB). `sizes` espelha o grid: 1 col → 2 (md) → 3 (xl).
          // `priority` só nos primeiros cards; o resto entra lazy sozinho.
          <Image
            src={criativo.thumbnail_url}
            alt={criativo.ad_name}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            priority={priority}
            className="object-cover"
            onError={() => setThumbQuebrada(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileVideo className="h-8 w-8 text-text-secondary/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        {/* nome + tags sobre a thumb */}
        <div className="absolute bottom-2 left-2 right-2 space-y-1">
          {/* Nome clicável → abre o modal de métricas (A-F3). */}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            title={`${criativo.ad_name || criativo.ad_id} — ver detalhes`}
            className="block text-left w-full text-sm font-semibold text-white drop-shadow truncate hover:underline"
          >
            {criativo.ad_name || criativo.ad_id}
            {(criativo.num_contas ?? 0) > 1 && (
              <span className="ml-1.5 align-middle text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200 border border-cyan-400/30" title="Mesmo criativo rodando em mais de uma conta Meta — métricas somadas">
                {criativo.num_contas} contas
              </span>
            )}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((t, i) => (
              <span
                key={`tax-${t}-${i}`}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/50 text-white/90 border border-white/15 backdrop-blur-sm truncate max-w-[8rem]"
              >
                {t}
              </span>
            ))}
            {shownTags.map((t) => (
              <span
                key={`tag-${t.id}`}
                title={`Tag ${t.namespace}: ${t.label}`}
                className="text-[10px] px-1.5 py-0.5 rounded-full text-white border backdrop-blur-sm truncate max-w-[8rem]"
                style={{ backgroundColor: (t.color ?? "#8b5cf6") + "cc", borderColor: t.color ?? "#8b5cf6" }}
              >
                {t.label}
              </span>
            ))}
            <TagAdder
              adRefs={criativo.ad_ids}
              applied={shownTags}
              onApplied={(t) => setLocalTags((prev) => (prev.some((x) => x.id === t.id) ? prev : [...prev, t]))}
            />
          </div>
        </div>
        {/* ações hover */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Copiar ID — copia o ad_id CANÔNICO (anúncio de maior lucro do grupo-por-nome)
              pra reusar/escalar direto na campanha do Meta. */}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(criativo.ad_id_canonico || criativo.ad_id)
                .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
                .catch(() => {});
            }}
            title={copied ? "ID copiado ✓" : `Copiar ID do anúncio de maior lucro (${criativo.ad_id_canonico || criativo.ad_id})`}
            className="p-1 rounded bg-black/50 text-white/80 border border-white/15 hover:bg-black/70"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => { setLightboxImg(null); setLightbox(true); }}
            title="Expandir"
            className="p-1 rounded bg-black/50 text-white/80 border border-white/15 hover:bg-black/70"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
          {anuncioUrl && (
            <a
              href={anuncioUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={anuncioLabel}
              className="p-1 rounded bg-black/50 text-white/80 border border-white/15 hover:bg-black/70"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* ===== Bloco de métricas (Gasto / ROAS / CPA / Impressões / Vendas) ===== */}
      <div className="grid grid-cols-2 gap-px bg-border">
        <Stat label="Gasto" value={brl(criativo.investimento)} />
        <Stat
          label="ROAS"
          value={roasFmt(criativo.roas)}
          badge
          badgeColor={COLOR[roasSinal]}
          sub={`CPA ${criativo.cpa !== null ? brl(criativo.cpa) : "—"}`}
        />
        <Stat label="Impressões" value={compact(criativo.impressoes)} />
        <Stat label="Vendas" value={String(criativo.vendas)} />
      </div>

      {/* ===== Barras de métrica (default CPM / CTR / Hook Rate) ===== */}
      <div className="px-3 py-2.5 space-y-1.5 border-t border-border">
        {bars.map((key) => (
          <Bar key={key} mkey={key} value={criativo[key] as number | null} />
        ))}
      </div>

      {/* ===== Rodapé ===== */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border mt-auto">
        <span className="text-[10px] font-medium" style={{ color: borderColor }}>{FADIGA_LABELS[fadiga]}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-[11px] px-2.5 py-1 rounded border border-border text-text-secondary hover:text-text-primary hover:border-text-primary transition-colors"
        >
          {expanded ? "Fechar" : "Ver análise"}
        </button>
      </div>

      {/* ===== Card expandido — Análise Equipe ===== */}
      {expanded && (
        <div className="border-t border-border bg-bg-base/40 px-3 py-3 space-y-3">
          {/* abas Resumo / Transcrição */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-semibold text-purple-300">⚡ Análise Equipe</span>
            <button
              onClick={() => setDetailTab("resumo")}
              className={`px-2 py-0.5 rounded ${detailTab === "resumo" ? "bg-purple-500/20 text-purple-200" : "text-text-secondary hover:text-text-primary"}`}
            >
              Resumo
            </button>
            <button
              onClick={() => setDetailTab("transcricao")}
              className={`px-2 py-0.5 rounded ${detailTab === "transcricao" ? "bg-purple-500/20 text-purple-200" : "text-text-secondary hover:text-text-primary"}`}
            >
              Transcrição
            </button>
          </div>

          {detailTab === "resumo" ? (
            <div className="space-y-2.5 text-[11px]">
              {resumo && <p className="text-text-primary/90 leading-relaxed border-l-2 border-purple-400/40 pl-2 italic">{resumo}</p>}

              {frames.length > 0 && (
                <Bloco label={`🖼️ Frames (${frames.length})`}>
                  <div className="flex gap-1.5 overflow-x-auto pb-1">
                    {frames.map((f, i) => (
                      <button
                        key={`${f.url}-${i}`}
                        type="button"
                        onClick={() => { setLightboxImg(f.url); setLightbox(true); }}
                        title={f.cat}
                        className="relative shrink-0 w-16 h-16 rounded overflow-hidden border border-border hover:border-purple-400 transition-colors"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={f.cat} loading="lazy" className="w-full h-full object-cover" />
                        <span className="absolute bottom-0 inset-x-0 text-[8px] text-center bg-black/60 text-white/80 capitalize">{f.cat}</span>
                      </button>
                    ))}
                  </div>
                </Bloco>
              )}

              {(hookDescricao || criativo.hook_tipo) && (
                <Bloco label="⚓ Hook (3s)">
                  {hookDescricao && <p className="text-text-primary/90 mb-1">{hookDescricao}</p>}
                  {criativo.hook_tipo && <Pills items={criativo.hook_tipo.map(mecanismoLabel)} />}
                </Bloco>
              )}
              {criativo.angulo_copy && <Bloco label="🎯 Ângulo de Copy"><Pills items={criativo.angulo_copy} /></Bloco>}
              {criativo.formato_visual && <Bloco label="🎬 Formato Visual"><Pills items={criativo.formato_visual.map(formatoLabel)} /></Bloco>}
              {criativo.elementos_visuais && <Bloco label="🧱 Elementos"><Pills items={criativo.elementos_visuais} /></Bloco>}
              {criativo.cta && <Bloco label="📣 CTA"><Pills items={criativo.cta} /></Bloco>}
              {criativo.producao && <Bloco label="🎥 Produção"><Pills items={criativo.producao} /></Bloco>}
              {criativo.estrutura_roteiro?.narrativa && (
                <Bloco label="🧩 Narrativa argumentativa">
                  <p className="text-text-primary/90">{criativo.estrutura_roteiro.narrativa}</p>
                </Bloco>
              )}
              {criativo.nivel_consciencia && (
                <Bloco label="🧠 Nível de consciência"><Pills items={[criativo.nivel_consciencia]} /></Bloco>
              )}
              {criativo.momento_funil && (
                <Bloco label="🎯 Momento do funil"><Pills items={[criativo.momento_funil]} /></Bloco>
              )}
              {criativo.promessa_principal && (
                <Bloco label="💬 Promessa principal">
                  <p className="text-text-primary font-medium">{criativo.promessa_principal}</p>
                </Bloco>
              )}

              {/* trend chart — janela = últimos dias ATIVOS do anúncio */}
              <div className="pt-1">
                <p className="text-[9px] uppercase tracking-wide text-text-secondary mb-1">
                  {trend?.meta
                    ? `Tendência Hold Rate · últimos ${trend.meta.activeDays}d ativos${trend.meta.stale && trend.meta.windowTo ? ` (até ${dm(trend.meta.windowTo)})` : ""} + proj. 7d`
                    : "Tendência Hold Rate · 7d + proj. 7d"}
                </p>
                {trendState === "loading" && <p className="text-[10px] text-text-secondary">carregando…</p>}
                {trendState === "error" && <p className="text-[10px] text-amber-400">não foi possível carregar a tendência</p>}
                {trend && (
                  <>
                    <MetricTrendChart history={trend.history} projection={trend.projection} metrica="Hold Rate" color={borderColor} format="percent" />
                    {trend.meta && trend.meta.basis !== "historico" && trend.meta.basis !== "sem-dados" && (
                      <p className="text-[9px] text-text-secondary mt-0.5">{BASIS_LABEL[trend.meta.basis]}</p>
                    )}
                  </>
                )}
              </div>

              {!resumo && !criativo.hook_tipo && !criativo.estrutura_roteiro && !criativo.promessa_principal && (
                <p className="text-text-secondary">Sem análise IA para este criativo ainda.</p>
              )}
            </div>
          ) : (
            <div className="text-[11px]">
              {transcricao ? (
                <p className="text-text-primary/90 whitespace-pre-wrap leading-relaxed">{transcricao}</p>
              ) : (
                <p className="text-text-secondary">Transcrição não disponível.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Lightbox (expandir) */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setLightbox(false)}
          >
            <X className="h-6 w-6" />
          </button>
          <div className="max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            {lightboxImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightboxImg} alt="frame" className="w-full max-h-[80vh] object-contain rounded-lg bg-black" />
            ) : criativo.video_url ? (
              <video
                src={criativo.video_url}
                poster={criativo.thumbnail_url ?? undefined}
                controls
                autoPlay
                className="w-full max-h-[80vh] rounded-lg bg-black"
              />
            ) : criativo.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={criativo.thumbnail_url} alt={criativo.ad_name} className="w-full max-h-[80vh] object-contain rounded-lg" />
            ) : (
              <p className="text-white/70 text-center py-12">Sem mídia disponível para este criativo.</p>
            )}
            {anuncioUrl && (
              <a
                href={anuncioUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-purple-300 hover:text-purple-200"
              >
                <ExternalLink className="h-4 w-4" /> {anuncioLabel}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- subcomponents ----------

function Stat({
  label,
  value,
  sub,
  badge = false,
  badgeColor,
}: {
  label: string;
  value: string;
  sub?: string;
  badge?: boolean;
  badgeColor?: string;
}) {
  return (
    <div className="bg-surface px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-text-secondary">{label}</p>
      <div className="flex items-baseline gap-1.5">
        {badge ? (
          <span
            className="text-sm font-bold tabular-nums px-1.5 rounded"
            style={{ color: badgeColor, background: `${badgeColor}1f` }}
          >
            {value}
          </span>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-text-primary">{value}</span>
        )}
        {sub && <span className="text-[9px] text-text-secondary">{sub}</span>}
      </div>
    </div>
  );
}

function Bar({ mkey, value }: { mkey: MetricKey; value: number | null }) {
  const cfg = BAR[mkey];
  const sinal = sinalFor(mkey, value);
  const filled = value !== null && Number.isFinite(value) ? Math.max(4, Math.min(100, (value / cfg.scale) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-text-secondary w-16 shrink-0">{cfg.label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-bg-base overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${filled}%`, background: COLOR[sinal] }} />
      </div>
      <span className="text-[10px] tabular-nums text-text-primary w-16 text-right shrink-0">
        {value !== null && Number.isFinite(value) ? cfg.fmt(value) : "—"}
      </span>
    </div>
  );
}

function Bloco({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wide text-text-secondary mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function Pills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-200 border border-purple-500/20"
        >
          {it}
        </span>
      ))}
    </div>
  );
}
