import { ImportBoard } from "@/components/admin/ImportBoard";
import { getAdminProducts } from "@/lib/admin/data";

export const metadata = { title: "Import products" };

/**
 * The catalogue is loaded here, not fetched by the board.
 *
 * The plan the merchant approves is a comparison against what the shop
 * currently holds, so the page cannot render a useful preview without it. The
 * server re-plans against the catalogue again before writing — this copy is
 * for showing, never for deciding.
 */
export default async function AdminImportPage() {
  const products = await getAdminProducts();
  return <ImportBoard products={products} />;
}
