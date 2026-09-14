import type { FitRecommendation, Locale, Product, ProductSize } from "@/types";

/**
 * Size recommendation.
 *
 * A transparent, auditable model rather than a black box — which matters,
 * because the customer is being told what to buy and a wrong confident answer
 * costs a return plus the trust to come back.
 *
 * How it works:
 *   1. Each size carries garment measurements (chest / waist / hip in cm).
 *   2. The customer's body measurement plus a target *ease* gives the ideal
 *      garment measurement for how they like clothes to sit.
 *   3. Every size is scored by total distance from that ideal, weighted toward
 *      the measurement that matters for the category (chest for tops, waist for
 *      trousers).
 *   4. Stretch shrinks the penalty for a garment being slightly small; it can
 *      never make a too-large garment correct.
 *   5. Confidence is the gap between the best and second-best score. Two sizes
 *      that score nearly the same genuinely means "between sizes", and the UI
 *      is expected to say so rather than pick one.
 *
 * Replacing this with an ML model later means swapping the body of
 * `recommendSize` — the return shape is the contract the UI depends on.
 */

export interface BodyProfile {
  heightCm?: number;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  preferredFit?: "slim" | "regular" | "relaxed";
}

/** Target ease in cm: how much room beyond the body the customer wants. */
const EASE_BY_PREFERENCE: Record<NonNullable<BodyProfile["preferredFit"]>, number> = {
  slim: 4,
  regular: 8,
  relaxed: 14,
};

/** Silhouettes carry their own intended ease; it adds to the customer's. */
const EASE_BY_SILHOUETTE: Record<NonNullable<Product["fit"]>["silhouette"], number> = {
  slim: 0,
  regular: 3,
  relaxed: 7,
  oversized: 13,
};

/** How much a too-small garment is forgiven, by stretch. */
const STRETCH_FORGIVENESS: Record<NonNullable<Product["fit"]>["stretch"], number> = {
  none: 0,
  slight: 2,
  moderate: 4,
  high: 7,
};

/** Which measurement dominates, per category. */
function weightsFor(categoryId: string) {
  switch (categoryId) {
    case "trousers":
      return { chest: 0, waist: 0.65, hip: 0.35 };
    case "dresses":
      return { chest: 0.45, waist: 0.3, hip: 0.25 };
    case "footwear":
    case "bags":
      return { chest: 0, waist: 0, hip: 0 };
    default:
      return { chest: 0.7, waist: 0.2, hip: 0.1 };
  }
}

function scoreSize(
  size: ProductSize,
  product: Product,
  body: BodyProfile,
): number | null {
  const measurements = size.measurements;
  if (!measurements) return null;

  const weights = weightsFor(product.categoryId);
  const totalWeight = weights.chest + weights.waist + weights.hip;
  if (totalWeight === 0) return null;

  const ease =
    EASE_BY_PREFERENCE[body.preferredFit ?? "regular"] +
    EASE_BY_SILHOUETTE[product.fit?.silhouette ?? "regular"];
  const forgiveness = STRETCH_FORGIVENESS[product.fit?.stretch ?? "none"];

  let penalty = 0;
  let applied = 0;

  const axes: [number | undefined, number | undefined, number][] = [
    [body.chestCm, measurements.chest, weights.chest],
    [body.waistCm, measurements.waist, weights.waist],
    [body.hipCm, measurements.hip, weights.hip],
  ];

  for (const [bodyValue, garmentValue, weight] of axes) {
    if (weight === 0 || bodyValue === undefined || garmentValue === undefined) continue;

    const ideal = bodyValue + ease;
    const delta = garmentValue - ideal;

    // Too tight is penalised harder than too loose — a garment that does not
    // close is unwearable, one that is roomy is merely not perfect. Stretch
    // reduces the tight-side penalty only.
    const adjusted = delta < 0 ? Math.max(0, Math.abs(delta) - forgiveness) * 1.6 : delta;

    penalty += Math.abs(adjusted) * weight;
    applied += weight;
  }

  if (applied === 0) return null;
  return penalty / applied;
}

export function recommendSize(product: Product, body: BodyProfile): FitRecommendation {
  const sized = product.sizes
    .map((size) => ({ size, score: scoreSize(size, product, body) }))
    .filter((entry): entry is { size: ProductSize; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score);

  // One-size items, shoes, and anything without a measurement table: fall back
  // to the model's size rather than guessing.
  if (sized.length === 0) {
    const fallback =
      product.sizes.find((s) => s.id === product.fit?.modelWearsSizeId) ?? product.sizes[0];

    return {
      productId: product.id,
      recommendedSizeId: fallback?.id ?? "",
      confidence: product.sizes.length === 1 ? 1 : 0.4,
      rationale:
        product.sizes.length === 1
          ? { en: "One size — no measurements needed.", ar: "مقاس واحد — لا حاجة للقياسات." }
          : {
              en: "No measurement table for this piece yet; showing the size our model wears.",
              ar: "لا يوجد جدول قياسات لهذه القطعة بعد؛ نعرض المقاس الذي ترتديه العارضة.",
            },
    };
  }

  const best = sized[0]!;
  const runnerUp = sized[1];

  // A clear winner is one that beats the alternative by a comfortable margin.
  // 6cm of separation is treated as full confidence.
  const separation = runnerUp ? runnerUp.score - best.score : 6;
  const confidence = Math.max(0.3, Math.min(1, separation / 6));

  const rationale: Record<Locale, string> =
    confidence < 0.6 && runnerUp
      ? {
          en: `You are between ${best.size.label} and ${runnerUp.size.label}. Take ${best.size.label} for a closer fit, ${runnerUp.size.label} for room.`,
          ar: `أنت بين مقاسي ${best.size.label} و${runnerUp.size.label}. اختر ${best.size.label} لقَصّة أقرب للجسم، و${runnerUp.size.label} لمساحة أوسع.`,
        }
      : {
          en: `${best.size.label} matches your measurements with the ease you prefer.`,
          ar: `المقاس ${best.size.label} يناسب قياساتك بالمساحة التي تفضّلها.`,
        };

  return {
    productId: product.id,
    recommendedSizeId: best.size.id,
    confidence,
    rationale,
    alternativeSizeId: runnerUp?.size.id,
  };
}

/** Convenience for the PDP: a one-line size hint without the full object. */
export function sizeHint(product: Product, body: BodyProfile, locale: Locale = "en") {
  return recommendSize(product, body).rationale[locale];
}
