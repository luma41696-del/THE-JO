"use client";

import { useId } from "react";

/**
 * The points coin.
 *
 * The same mark as `public/brand/net-sale-icon.svg` — the red blob and the N
 * are the identical path data — struck as a coin: gold, milled edge, laurel,
 * stars. Redrawing the letterform by eye would have produced a logo that is
 * *nearly* the shop's, which is worse than either drawing it properly or not
 * using it.
 *
 * ## Two levels of detail, because it is used at 16px and at 96px
 *
 * A wreath and eight stars at sixteen pixels is grey mush with a red dot in
 * it. Below `DETAIL_FROM` the coin drops to a disc, a rim and the mark, which
 * is what actually reads at the size a balance is written at. This is the
 * whole reason it is a component and not an `<img>`.
 *
 * ## Gradients need unique ids
 *
 * Several coins on one page — a balance, then a row per ledger entry — each
 * carry their own `<defs>`. Shared ids mean the last one defined wins and
 * every coin above it silently re-renders with the wrong fill, or none.
 * `useId` keeps them apart.
 */

/** Below this many pixels the wreath and stars are dropped. */
const DETAIL_FROM = 40;

const GOLD = {
  light: "#FBE7A1",
  mid: "#E8B93C",
  deep: "#B8861B",
  shadow: "#8C6410",
} as const;

const RED = { light: "#E8302F", deep: "#B60F12" } as const;

/** Eight ticks around the rim, as a star each. */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    // Start at the top, so a five-pointed star sits upright.
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(" ");
}

/** One laurel leaf, mirrored by the caller. */
const LEAF = "M0 0 C 5 -3.4, 10 -3.4, 14 0 C 10 3.4, 5 3.4, 0 0 Z";

export function PointsCoin({
  size = 20,
  className,
  title,
}: {
  size?: number;
  className?: string;
  /**
   * An accessible name. Left empty the coin is decorative, which is right when
   * it sits beside the word "points" — announcing it twice helps nobody.
   */
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const detailed = size >= DETAIL_FROM;

  const face = `face-${id}`;
  const rim = `rim-${id}`;
  const blob = `blob-${id}`;
  const letter = `letter-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}

      <defs>
        <linearGradient id={face} x1="20" y1="10" x2="100" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={GOLD.light} />
          <stop offset="0.45" stopColor={GOLD.mid} />
          <stop offset="1" stopColor={GOLD.deep} />
        </linearGradient>
        <linearGradient id={rim} x1="100" y1="10" x2="20" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={GOLD.mid} />
          <stop offset="0.5" stopColor={GOLD.light} />
          <stop offset="1" stopColor={GOLD.shadow} />
        </linearGradient>
        <linearGradient id={blob} x1="34" y1="30" x2="88" y2="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={RED.light} />
          <stop offset="1" stopColor={RED.deep} />
        </linearGradient>
        <linearGradient id={letter} x1="40" y1="44" x2="84" y2="78" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFF4CE" />
          <stop offset="1" stopColor={GOLD.mid} />
        </linearGradient>
      </defs>

      {/* The blank: rim, then the struck face inside it. */}
      <circle cx="60" cy="60" r="59" fill={`url(#${rim})`} />
      <circle cx="60" cy="60" r="53" fill={`url(#${face})`} />

      {detailed && (
        <>
          {/* Milling. Drawn as dashes on a thick stroke rather than as sixty
              paths — it is texture, and sixty paths is a texture that costs. */}
          <circle
            cx="60"
            cy="60"
            r="56.5"
            fill="none"
            stroke={GOLD.shadow}
            strokeOpacity="0.55"
            strokeWidth="5"
            strokeDasharray="1.6 2.4"
          />
          <circle cx="60" cy="60" r="47" fill="none" stroke={GOLD.shadow} strokeOpacity="0.35" strokeWidth="1.2" />

          {/* Stars, top and bottom. */}
          {[-1, 0, 1].map((offset) => (
            <polygon
              key={`t${offset}`}
              points={starPoints(60 + offset * 14, offset === 0 ? 15 : 18.5, 4.6, 1.9)}
              fill={GOLD.shadow}
              fillOpacity="0.55"
            />
          ))}
          {[-1, 0, 1].map((offset) => (
            <polygon
              key={`b${offset}`}
              points={starPoints(60 + offset * 14, offset === 0 ? 105 : 101.5, 4.6, 1.9)}
              fill={GOLD.shadow}
              fillOpacity="0.55"
            />
          ))}

          {/*
            Laurel down each side, one drawn and the other mirrored.

            The arc runs 135° to 225° — upper-left, round the left edge, to
            lower-left — which is a wreath. Sweeping across the top instead
            reads as a smear, which is what the first attempt at this did.

            Each leaf is turned along the tangent at its own angle. Screen y is
            inverted, so the tangent direction is `atan2(-cos, -sin)` and not
            the `90 - angle` that looks right on paper.
          */}
          {[1, -1].map((side) => (
            <g key={side} transform={side === 1 ? undefined : "translate(120 0) scale(-1 1)"}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const angle = 133 + i * 18.8;
                const radians = (angle * Math.PI) / 180;
                const x = 60 + 40 * Math.cos(radians);
                const y = 60 - 40 * Math.sin(radians);
                const tangent =
                  (Math.atan2(-Math.cos(radians), -Math.sin(radians)) * 180) / Math.PI;
                return (
                  <path
                    key={i}
                    d={LEAF}
                    fill={GOLD.shadow}
                    fillOpacity="0.5"
                    transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tangent.toFixed(1)}) translate(-7 0)`}
                  />
                );
              })}
            </g>
          ))}
        </>
      )}

      {/*
        The mark. Same path data as the brand icon, scaled about the centre —
        its own coordinate space runs 8..112 around a centre of 60, so the
        translate/scale/translate puts it on the coin without touching the
        numbers.
      */}
      <g transform="translate(60 60) scale(0.62) translate(-60 -60)">
        <path
          d="M 60 11.84 C 46.37 13.24, 33.41 21.13, 19.6 36.43 C 13.46 43.23, 10.38 47.6, 8.77 51.82 C 8.14 53.49, 8.04 54.22, 8.02 57.21 C 8 62.31, 8.67 63.55, 15.46 71.02 C 22.71 78.99, 24.45 82.26, 25.86 90.63 C 26.92 96.95, 28.44 100.07, 31.79 102.86 C 36.22 106.54, 44.71 108.64, 55.19 108.62 C 67.63 108.61, 77.45 105.41, 85.21 98.85 C 87.85 96.61, 89.23 94.84, 98.51 81.78 C 107.27 69.44, 109.01 66.68, 110.9 62.11 C 111.91 59.66, 111.97 59.33, 111.99 56.33 C 112 53.2, 111.98 53.11, 110.88 50.88 C 109.39 47.87, 106.34 44.7, 100.77 40.39 C 92.75 34.17, 89.84 30.88, 86.11 23.84 C 82.95 17.85, 79.57 14.7, 74.53 13.02 C 71.11 11.89, 64.66 11.36, 60 11.84"
          fill={`url(#${blob})`}
        />
        <path
          d="M 95.42 91.13 C 93.94 92.13, 93.28 93.49, 93.29 95.52 C 93.31 98.73, 94.93 100.28, 98.29 100.28 C 101.31 100.28, 102.93 99.19, 103.51 96.77 C 104.17 94.04, 103.3 91.71, 101.3 90.88 C 99.73 90.22, 96.57 90.36, 95.42 91.13"
          fill={`url(#${blob})`}
        />
        {/* The N, gold on the red rather than ink on it: this is a coin. */}
        <path
          d="M 64.19 40.82 C 59.41 42.57, 58.22 49.57, 62.13 52.91 C 64.19 54.68, 65.13 54.8, 75.61 54.7 C 84.52 54.62, 84.97 54.59, 86.07 53.99 C 89.44 52.17, 90.78 48.63, 89.51 44.89 C 88.95 43.25, 86.75 41.11, 85.18 40.67 C 83.36 40.17, 65.63 40.29, 64.19 40.82"
          fill={`url(#${letter})`}
        />
        <path
          d="M 39.58 44.25 C 36.43 45.14, 32.97 47.84, 31.59 50.51 C 30.1 53.4, 30.04 53.91, 30.04 64.84 C 30.04 75.05, 30.05 75.13, 30.71 76.39 C 32.71 80.17, 37.95 81.14, 41.15 78.33 C 43.34 76.41, 43.42 76.03, 43.58 67.06 L 43.73 59.05 47.18 62.59 C 62.83 78.68, 62.94 78.78, 66.44 79.71 C 74.37 81.82, 82.47 75.08, 82.47 66.37 C 82.47 64.15, 81.84 62.33, 80.53 60.81 C 76.81 56.46, 69.97 58.54, 68.98 64.33 C 68.79 65.49, 68.79 65.49, 61.98 58.32 C 51.73 47.54, 49.53 45.47, 47.46 44.69 C 45.24 43.85, 41.71 43.65, 39.58 44.25"
          fill={`url(#${letter})`}
        />
      </g>
    </svg>
  );
}

/**
 * A points figure with its coin.
 *
 * The number is `tabular-nums` and `dir="ltr"`: a balance sits in Arabic
 * copy, and bidi reorders a bare number next to a symbol into something that
 * is not the number.
 */
export function PointsAmount({
  points,
  size = 18,
  className,
}: {
  points: number;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`} dir="ltr">
      <PointsCoin size={size} />
      <span className="tabular-nums">{points.toLocaleString()}</span>
    </span>
  );
}
