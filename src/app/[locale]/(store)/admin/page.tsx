import type { Metadata } from "next";
import { Link } from "@/components/ui/Link";

import { getActiveOffers, getAllProducts, getBanners } from "@/lib/catalog";
import { formatPrice } from "@/lib/format";
import { PageIntro } from "@/components/ui/PageIntro";
import { Reveal } from "@/components/ui/Reveal";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Admin (concept)",
  robots: { index: false, follow: false },
};

/**
 * Admin dashboard — concept.
 *
 * Read-only on purpose. It shows the shape of the operations surface (what a
 * merchandiser needs to see at a glance) without shipping any write path, so
 * there is no half-secured mutation endpoint sitting in the repo waiting to be
 * forgotten about.
 *
 * Before this becomes real, it needs, in order:
 *   1. A `role` custom claim (`staff` | `admin`), set by a Cloud Function and
 *      verified in `middleware.ts` — not by a check in this component.
 *   2. Security Rules that allow writes to `products` / `banners` / `offers`
 *      only when `request.auth.token.role in ['staff','admin']`.
 *   3. Server Actions or route handlers for every mutation, each re-verifying
 *      the claim server-side. A client-side role check is a UI convenience, and
 *      nothing more.
 */
export default async function AdminConceptPage() {
  const [products, banners, offers] = await Promise.all([
    getAllProducts(),
    getBanners("promo-rail"),
    getActiveOffers(),
  ]);

  const lowStock = products.filter((p) => p.totalStock <= 6);
  const inventoryValue = products.reduce((sum, p) => sum + p.price * p.totalStock, 0);
  const currency = products[0]?.currency ?? "JOD";

  const stats = [
    { label: "Active products", value: products.length.toString() },
    { label: "Live campaigns", value: banners.length.toString() },
    { label: "Running offers", value: offers.length.toString() },
    { label: "Inventory value", value: formatPrice(inventoryValue, currency) },
  ];

  return (
    <>
      {/* Internal tooling stays in English: it is read by the team, not by
          shoppers, and a half-translated admin surface is worse than one. */}
      <PageIntro
        eyebrow="Internal · concept"
        title="Operations dashboard"
        description="A read-only sketch of the merchandising surface. Nothing here writes to Firestore — see the note at the bottom for what shipping it would require."
      />

      <div className="jo-container pb-24">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat, index) => (
            <Reveal key={stat.label} delay={index * 0.06}>
              <div className="bg-paper-raised border-line rounded-lg border p-6">
                <p className="text-eyebrow font-display text-mist uppercase">{stat.label}</p>
                <p className="font-display text-ink mt-3 text-2xl font-semibold tabular-nums">
                  {stat.value}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Low stock */}
        <section className="mt-12">
          <h2 className="font-display text-ink mb-4 text-lg font-semibold">
            Needs attention{" "}
            <span className="text-mist font-normal tabular-nums">({lowStock.length})</span>
          </h2>

          {lowStock.length === 0 ? (
            <p className="border-line text-smoke rounded-lg border border-dashed p-10 text-center text-[0.9375rem]">
              Every piece is comfortably in stock.
            </p>
          ) : (
            <div className="border-line rounded-lg overflow-hidden border">
              <table className="w-full text-start text-[0.875rem]">
                <thead className="bg-paper-sunken text-mist text-[0.6875rem] tracking-[0.12em] uppercase">
                  <tr>
                    <th className="px-5 py-3 text-start font-medium">Piece</th>
                    <th className="px-5 py-3 text-start font-medium">Category</th>
                    <th className="px-5 py-3 text-end font-medium">Stock</th>
                    <th className="px-5 py-3 text-end font-medium">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {lowStock.map((product) => (
                    <tr key={product.id} className="hover:bg-paper-sunken/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/product/${product.slug}`}
                          className="text-ink jo-underline font-medium"
                        >
                          {product.title.en}
                        </Link>
                        {product.badges[0] && (
                          <Badge badge={product.badges[0]} className="ms-2 align-middle" />
                        )}
                      </td>
                      <td className="text-smoke px-5 py-3.5 capitalize">{product.categoryId}</td>
                      <td className="text-coral px-5 py-3.5 text-end font-medium tabular-nums">
                        {product.totalStock}
                      </td>
                      <td className="text-ink px-5 py-3.5 text-end tabular-nums">
                        {formatPrice(product.price, product.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Campaigns */}
        <section className="mt-12">
          <h2 className="font-display text-ink mb-4 text-lg font-semibold">Live campaigns</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {banners.map((banner) => (
              <div key={banner.id} className="bg-paper-raised border-line rounded-lg border p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-ink text-[0.9375rem] font-medium">
                    {banner.title.en.replace(/\n/g, " ")}
                  </p>
                  <span className="bg-violet-mist text-violet-deep rounded-xs shrink-0 px-2 py-0.5 text-[0.6875rem] tabular-nums">
                    P{banner.priority}
                  </span>
                </div>
                <p className="text-smoke mt-2 text-[0.75rem]">
                  slot: <span className="text-ink-muted">{banner.slot}</span> · tone:{" "}
                  <span className="text-ink-muted">{banner.tone}</span>
                  {banner.endsAt && <> · ends {new Date(banner.endsAt).toLocaleDateString()}</>}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Build note */}
        <aside className="bg-violet-veil rounded-xl mt-14 p-7">
          <h2 className="font-display text-ink text-base font-semibold">
            What shipping this for real requires
          </h2>
          <ol className="text-ink-muted mt-4 space-y-2.5 text-[0.9375rem]">
            <li>
              <strong className="text-ink font-medium">1. Role claim.</strong> A Cloud Function sets{" "}
              <code className="bg-paper-sunken rounded-xs px-1.5 py-0.5 text-[0.8125rem]">
                role: &quot;admin&quot;
              </code>{" "}
              as a custom claim. Claims are signed by Firebase and cannot be forged by a client.
            </li>
            <li>
              <strong className="text-ink font-medium">2. Edge gate.</strong>{" "}
              <code className="bg-paper-sunken rounded-xs px-1.5 py-0.5 text-[0.8125rem]">
                middleware.ts
              </code>{" "}
              verifies a session cookie on <code>/admin/*</code> and redirects everyone else. This
              keeps the bundle itself from being served to the public.
            </li>
            <li>
              <strong className="text-ink font-medium">3. Rules.</strong> Writes to{" "}
              <code>products</code>, <code>banners</code> and <code>offers</code> gated on the same
              claim, so even a leaked API key cannot edit the catalogue.
            </li>
            <li>
              <strong className="text-ink font-medium">4. Server-side mutations.</strong> Every
              write through a Server Action that re-verifies the claim. The UI check is convenience;
              the server check is the control.
            </li>
            <li>
              <strong className="text-ink font-medium">5. Audit trail.</strong> An{" "}
              <code>auditLog</code> collection written by a Firestore trigger — who changed which
              price, and when.
            </li>
          </ol>
        </aside>
      </div>
    </>
  );
}
