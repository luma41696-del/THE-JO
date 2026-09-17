import { BehaviourBoard } from "@/components/admin/BehaviourBoard";
import { getAdminProducts, getAnalyticsEvents } from "@/lib/admin/data";

export const metadata = { title: "Shopping behaviour" };

/** Always fresh: a report read from a cache is a report about the past. */
export const dynamic = "force-dynamic";

export default async function AdminBehaviourPage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string }>;
}) {
  const { uid } = await searchParams;
  // Ninety days is the widest period the board offers, so one read covers
  // every selection and the period buttons filter in memory.
  const from = Date.now() - 90 * 86_400_000;

  const [{ rows, live, truncated }, products] = await Promise.all([
    getAnalyticsEvents(from),
    getAdminProducts(),
  ]);

  return (
    <BehaviourBoard
      events={rows}
      products={products}
      live={live}
      truncated={truncated}
      uid={uid}
    />
  );
}
