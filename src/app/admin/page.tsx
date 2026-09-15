import { Dashboard } from "@/components/admin/Dashboard";
import { LowStockPanel } from "@/components/admin/LowStockPanel";
import { ErrorReports } from "@/components/admin/ErrorReports";
import {
  adminNow,
  getAdminCategories,
  getAdminOrders,
  getAdminProducts,
  getAdminTickets,
  getErrorReports,
} from "@/lib/admin/data";
import { getStoreSettings } from "@/lib/settings";
import { lowStockAlerts } from "@/lib/stock";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const [{ rows: orders, live }, { rows: tickets }, categories, products, settings, errors] =
    await Promise.all([
      getAdminOrders(),
      getAdminTickets(),
      getAdminCategories(),
      getAdminProducts(),
      getStoreSettings(),
      getErrorReports(),
    ]);

  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name.en]));

  /*
   * Computed on the server: this walks every variant of every product, which
   * is work the browser has no reason to do — and the result is a short list
   * either way.
   */
  const alerts = lowStockAlerts(products, settings.lowStockThreshold);

  return (
    <>
      <Dashboard
        orders={orders}
        tickets={tickets}
        now={adminNow(orders, live)}
        categoryNames={categoryNames}
      />

      {/*
        Below the trading charts rather than above them: this is the buying
        queue, not the headline. It is still on the first screen a merchant
        opens, which is the point — a reorder list nobody navigates to is a
        reorder list nobody reads.
      */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <LowStockPanel alerts={alerts} threshold={settings.lowStockThreshold} />
        {/*
          Beside the buying queue rather than buried on its own page. Both
          answer "what needs a person today", and an error list nobody
          navigates to is an error list nobody reads.
        */}
        <ErrorReports reports={errors} />
      </div>
    </>
  );
}
