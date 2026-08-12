"use client";

interface TrendPoint {
  day: string; // ISO date
  value: number | null;
}

interface MetricTrendChartProps {
  history: TrendPoint[]; // 7 dias passados
  projection: TrendPoint[]; // 7 dias futuros
  metrica: string; // label informativo (ex: "Hold Rate")
  color?: string;
  format?: "percent" | "currency" | "number";
}

function formatValue(v: number | null, format: "percent" | "currency" | "number"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (format === "percent") return `${(v * 100).toFixed(1)}%`;
  if (format === "currency")
    return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v.toFixed(2);
}

/** Valor compacto para caber DENTRO do quadradinho da tendência. */
function compactValue(v: number | null, format: "percent" | "currency" | "number"): string {
  if (v === null || !Number.isFinite(v)) return "";
  if (format === "percent") return `${(v * 100).toFixed(1)}`; // % implícito (espaço apertado)
  if (format === "currency") {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return v.toFixed(0);
  }
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
}

function formatDay(iso: string): string {
  // ISO YYYY-MM-DD → DD/MM
  if (!iso || iso.length < 10) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const BAR_AREA_H = 64;
const LABEL_AREA_H = 14;

export function MetricTrendChart({
  history,
  projection,
  metrica,
  color = "#10b981",
  format = "percent",
}: MetricTrendChartProps) {
  const all = [...history, ...projection];
  const validValues = all
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const maxV = validValues.length > 0 ? Math.max(...validValues) : 0;
  const safeMax = maxV > 0 ? maxV : 1;

  const totalBars = all.length;
  // mostrar labels apenas no primeiro, meio (~D-3) e último de cada grupo
  const labelIdx = new Set<number>();
  if (history.length > 0) {
    labelIdx.add(0);
    if (history.length > 2) labelIdx.add(Math.floor(history.length / 2));
    labelIdx.add(history.length - 1);
  }
  if (projection.length > 0) {
    const off = history.length;
    labelIdx.add(off);
    if (projection.length > 2) labelIdx.add(off + Math.floor(projection.length / 2));
    labelIdx.add(off + projection.length - 1);
  }

  return (
    <div
      className="w-full select-none"
      role="img"
      aria-label={`Tendência de ${metrica} — 7 dias passados e 7 dias projetados`}
    >
      {/* Barras */}
      <div
        className="relative flex items-end gap-[2px]"
        style={{ height: `${BAR_AREA_H}px` }}
      >
        {all.map((p, i) => {
          const isProjection = i >= history.length;
          const isEmpty = p.value === null || !Number.isFinite(p.value);
          const ratio = isEmpty ? 0 : (p.value as number) / safeMax;
          const h = isEmpty ? 2 : Math.max(2, Math.round(ratio * BAR_AREA_H));
          const bg = isEmpty ? "#3f3f46" : color;
          const opacity = isEmpty ? 0.4 : isProjection ? 0.35 : 1;
          const tip = `${p.day} · ${formatValue(p.value, format)}${
            isProjection ? " (projeção)" : ""
          }`;
          const valLabel = compactValue(p.value, format);
          return (
            <div
              key={`${p.day}-${i}`}
              className="flex-1 relative flex items-end"
              style={{ height: `${BAR_AREA_H}px` }}
              title={tip}
            >
              <div
                className="w-full"
                style={{
                  height: `${h}px`,
                  background: bg,
                  opacity,
                  borderRadius: "1px",
                }}
              />
              {/* número da métrica DENTRO do quadradinho (sempre no topo, legível) */}
              {valLabel && (
                <span
                  className="absolute inset-x-0 top-1 text-center text-[8.5px] font-semibold tabular-nums leading-none pointer-events-none"
                  style={{ color: isProjection ? "#9ca3af" : "#e5e7eb" }}
                >
                  {valLabel}
                </span>
              )}
            </div>
          );
        })}

        {/* Linha divisória "hoje" entre history e projection */}
        {history.length > 0 && projection.length > 0 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(${(history.length / totalBars) * 100}% - 1px)`,
              width: "1px",
              background: "#6b7280",
              opacity: 0.7,
            }}
          >
            <span
              className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-wider text-text-secondary"
              style={{ whiteSpace: "nowrap" }}
            >
              hoje
            </span>
          </div>
        )}
      </div>

      {/* Labels */}
      <div
        className="flex gap-[2px] mt-1"
        style={{ height: `${LABEL_AREA_H}px` }}
      >
        {all.map((p, i) => (
          <div
            key={`lbl-${p.day}-${i}`}
            className="flex-1 text-[8px] text-text-secondary text-center tabular-nums leading-none"
          >
            {labelIdx.has(i) ? formatDay(p.day) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
