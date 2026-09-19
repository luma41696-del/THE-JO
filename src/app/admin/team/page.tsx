import { TeamBoard } from "@/components/admin/TeamBoard";
import { IpBlocklist } from "@/components/admin/IpBlocklist";

export const metadata = { title: "Access" };

/**
 * Deliberately a thin client screen rather than a server-rendered list.
 *
 * Every other admin page reads Firestore on the server and passes rows down.
 * This one reads **Firebase Auth**, where the roles actually live, and it does
 * so through `/api/admin/team` so that one route is the only place a role can
 * be read or changed — with one verification, one audit trail, and one set of
 * rules about who may do it.
 */
export default function AdminTeamPage() {
  /*
   * The blocklist lives here rather than with the customers, because it is
   * access control and not a customer record: most of what it keeps out has no
   * account at all. The customer screen blocks the person; this blocks the
   * door.
   */
  return (
    <div className="space-y-4">
      <TeamBoard />
      <IpBlocklist />
    </div>
  );
}
