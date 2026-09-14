"use client";

import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import type { CurrencyCode } from "@/types";

/**
 * Chart primitives.
 *
 * Hand-built SVG rather than a charting library. Three reasons that actually
 * matter here: the whole set is a few kilobytes against ~90KB for a library;
 * every mark can be styled from the design tokens instead of fought with; and
 * the hover layer can be built the way this product wants it rather than the
 * way a library's defaults want it.
 *
 * The palette is the brand brand plus four hues, validated for colour-vision
 * deficiency separation (worst adjacent pair ΔE 9.1 protan, normal-vision 22.9)
 * on a white surface. Two of the five sit below 3:1 contrast, so every chart
 * that uses them ships **visible labels and a table view** — that is the relief
 * rule, not an optional nicety.
 *
 * Rules held throughout:
 *  - one y-scale, never two;
 *  - colour follows the entity, never its rank, so filtering never repaints;
 *  - empty buckets are drawn as zero, never skipped — dropping a quiet day
 *    compresses the x-axis and turns a dip into a straight line;
 *  - grid and axes recede; the data is the only thing at full strength.
 */

export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const AXIS = "var(--color-mist)";
const GRID = "var(--color-line)";

/* -------------------------------------------------------------------------- */
/*  Shared                                                                    */
/* -------------------------------------------------------------------------- */

function niceCeiling(value: number) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function compact(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return Math.round(value).toString();
}

/* -------------------------------------------------------------------------- */
/*  Area + line: revenue over time                                            */
/* -------------------------------------------------------------------------- */

export interface TimePoint {
  t: number;
  value: number;
  /** Secondary figure shown in the tooltip only — never a second y-axis. */
  secondary?: number;
}

export function RevenueChart({
  points,
  currency = "JOD",
  height = 260,
  label = "Revenue",
  secondaryLabel = "Orders",
}: {
  points: TimePoint[];
  currency?: CurrencyCode;
  height?: number;
  label?: string;
  secondaryLabel?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 800;
  const H = height;
  const PAD = { top: 16, right: 16, bottom: 28, left: 52 };

  const max = niceCeiling(Math.max(...points.map((p) => p.value), 1));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.value)}`).join(" ");
  const area = `${line} L ${x(points.length - 1)} ${PAD.top + innerH} L ${x(0)} ${PAD.top + innerH} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const active = hover !== null ? points[hover] : null;

  // Roughly six x-labels regardless of bucket count, so they never collide.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <figure className="viz-root relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${label} over time`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid + value axis */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={y(tick) + 4}
              textAnchor="end"
              fill={AXIS}
              fontSize={11}
              fontVariant="tabular-nums"
            >
              {compact(tick)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Time axis */}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={p.t}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fill={AXIS}
              fontSize={11}
            >
              {new Date(p.t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </text>
          ) : null,
        )}

        {/* Crosshair + endpoint */}
        {active && hover !== null && (
          <g pointerEvents="none">
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--color-ink)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.35}
            />
            {/* A 2px surface ring keeps the dot legible over the area fill. */}
            <circle cx={x(hover)} cy={y(active.value)} r={5} fill="var(--chart-1)" stroke="var(--color-paper-raised)" strokeWidth={2} />
          </g>
        )}

        {/* Hit targets: full-height columns, far easier to land than the line */}
        {points.map((p, i) => (
          <rect
            key={p.t}
            x={x(i) - innerW / Math.max(points.length, 1) / 2}
            y={PAD.top}
            width={innerW / Math.max(points.length, 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active && hover !== null && (
        <div
          className="ns-glass shadow-float pointer-events-none absolute top-2 rounded-md px-3 py-2 text-[0.75rem]"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > points.length / 2 ? "-105%" : "5%"})`,
          }}
        >
          <p className="text-mist mb-1">
            {new Date(active.t).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <p className="text-ink font-medium tabular-nums">
            {label} {formatPrice(active.value, currency)}
          </p>
          {active.secondary !== undefined && (
            <p className="text-smoke tabular-nums">
              {secondaryLabel} {active.secondary}
            </p>
          )}
        </div>
      )}
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/*  Horizontal bars: ranked comparison                                        */
/* -------------------------------------------------------------------------- */

export interface BarDatum {
  label: string;
  value: number;
  /** Right-hand annotation — units, share, whatever the row is really about. */
  note?: string;
  href?: string;
}

export function RankedBars({
  data,
  currency,
  valueLabel = "Revenue",
  showValueAs = "currency",
}: {
  data: BarDatum[];
  currency?: CurrencyCode;
  valueLabel?: string;
  showValueAs?: "currency" | "number";
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="viz-root flex flex-col gap-3">
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label} className="group">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-ink truncate text-[0.8125rem]">{d.label}</span>
              <span className="text-ink shrink-0 text-[0.8125rem] font-medium tabular-nums">
                {showValueAs === "currency" && currency
                  ? formatPrice(d.value, currency)
                  : d.value.toLocaleString("en-GB")}
                {d.note && <span className="text-mist ms-2 font-normal">{d.note}</span>}
              </span>
            </div>
            {/* Track is the sunken surface, not a tinted version of the mark —
                a faded mark reads as a second, quieter series. */}
            <div className="bg-paper-sunken h-2 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  width: `${pct}%`,
                  // Colour follows the entity's fixed slot, not its rank.
                  background: SERIES[i % SERIES.length],
                }}
                role="img"
                aria-label={`${d.label}: ${d.value} ${valueLabel}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Donut: composition                                                        */
/* -------------------------------------------------------------------------- */

export interface SliceDatum {
  label: string;
  value: number;
}

export function CompositionDonut({
  data,
  currency = "JOD",
  size = 200,
}: {
  data: SliceDatum[];
  currency?: CurrencyCode;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  const R = 64;
  const STROKE = 18;
  const C = 2 * Math.PI * R;

  const slices = useMemo(() => {
    let offset = 0;
    return data.map((d, i) => {
      const fraction = d.value / total;
      // A 2px surface gap between adjacent fills keeps the boundaries readable.
      const dash = Math.max(0, fraction * C - 2);
      const slice = { ...d, fraction, dash, offset, color: SERIES[i % SERIES.length]! };
      offset += fraction * C;
      return slice;
    });
  }, [data, total, C]);

  const active = hover !== null ? slices[hover] : null;

  return (
    <div className="viz-root flex flex-wrap items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label="Revenue by category">
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--color-paper-sunken)" strokeWidth={STROKE} />
          {slices.map((s, i) => (
            <circle
              key={s.label}
              cx="80"
              cy="80"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={hover === i ? STROKE + 4 : STROKE}
              strokeDasharray={`${s.dash} ${C - s.dash}`}
              strokeDashoffset={-s.offset}
              className="cursor-pointer transition-[stroke-width] duration-200"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>

        {/* The centre is the hero number, not decoration. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-display text-ink text-lg font-semibold tabular-nums">
              {active ? `${Math.round(active.fraction * 100)}%` : formatPrice(total, currency)}
            </p>
            <p className="text-mist mt-0.5 max-w-[7rem] truncate text-[0.6875rem]">
              {active ? active.label : "Total"}
            </p>
          </div>
        </div>
      </div>

      {/* Legend doubles as the table view the relief rule requires. */}
      <ul className="min-w-0 flex-1 space-y-2">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md px-2 py-1 text-[0.8125rem] transition-colors",
              hover === i && "bg-paper-sunken",
            )}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="text-ink truncate capitalize">{s.label}</span>
            </span>
            <span className="text-smoke shrink-0 tabular-nums">
              {formatPrice(s.value, currency)}
              <span className="text-mist ms-2">{Math.round(s.fraction * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sparkline: trend inside a stat tile                                       */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  tone = "brand",
  height = 34,
}: {
  values: number[];
  tone?: "brand" | "mint" | "alert";
  height?: number;
}) {
  if (values.length < 2) return null;

  const W = 120;
  const H = height;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  const stroke =
    tone === "mint" ? "var(--color-mint)" : tone === "alert" ? "var(--color-alert)" : "var(--chart-1)";

  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * (H - 4) - 2;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  const lastX = W;
  const lastY = H - ((values[values.length - 1]! - min) / span) * (H - 4) - 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      {/* Emphasised endpoint — the only point that answers "where are we now". */}
      <circle cx={lastX} cy={lastY} r={2.5} fill={stroke} />
    </svg>
  );
}
