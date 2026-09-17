import { notFound } from "next/navigation";

import { CampaignComposer } from "@/components/admin/CampaignComposer";
import { getAdminProducts } from "@/lib/admin/data";
import { getAdminSession } from "@/lib/firebase/session";
import { absoluteUrl } from "@/lib/site";

export const metadata = { title: "Email campaigns" };

/**
 * The campaign screen.
 *
 * Administrator only, and refused here rather than hidden: every route behind
 * this checks again, but a screen that renders the shop's whole customer count
 * to somebody who cannot use it has already told them something.
 *
 * Products are read here and passed down so the picker has titles, prices and
 * images without the browser fetching the catalogue — the same list the rest
 * of the admin is built from.
 */
export default async function AdminCampaignsPage() {
  const session = await getAdminSession();
  if (session?.role !== "admin") notFound();

  const products = await getAdminProducts();

  return (
    <CampaignComposer
      products={products
        // Only what a customer could actually buy: a campaign linking to a
        // draft or an archived product sends people to a dead page.
        .filter((product) => product.status === "active" && product.visibility !== "hidden")
        .slice(0, 300)
        .map((product) => ({
          id: product.id,
          title: product.title.en || product.title.ar || product.slug,
          imageUrl: product.images?.[0]?.url,
          price: product.price,
          url: absoluteUrl(`ar/product/${product.slug}`),
        }))}
    />
  );
}
