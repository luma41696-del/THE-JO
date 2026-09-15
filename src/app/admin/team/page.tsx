import { TeamBoard } from "@/components/admin/TeamBoard";

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
  return <TeamBoard />;
}
