import type { Locale, Localized } from "@/types";

/**
 * Who may make someone else staff, and who may not.
 *
 * Until now the only way to grant a role was `npm run grant-admin` on a machine
 * holding the service-account key. That is the right *bootstrap* — the first
 * admin has to come from somewhere outside the app — but it made every
 * subsequent grant a developer errand, and a shop owner who cannot add their
 * own staff does not really own the admin.
 *
 * Moving it into the site moves an irreversible, privilege-granting action
 * behind an HTTP route, so the rules are written here, alone, pure, and tested
 * exhaustively rather than inferred from the shape of a form.
 *
 * The role itself is still a **Firebase custom claim**, never a Firestore
 * field: a claim is signed by Firebase and travels inside the ID token, so
 * rules and server routes can trust it. A `role` field on a profile document is
 * only as trustworthy as the rules on that document — and a user who can edit
 * their own profile can promote themselves.
 */

export type Role = "customer" | "staff" | "admin";

export const ROLES: Role[] = ["customer", "staff", "admin"];

export const ROLE_LABELS: Record<Role, Localized> = {
  customer: { en: "No access", ar: "بدون صلاحية" },
  staff: { en: "Staff", ar: "موظف" },
  admin: { en: "Admin", ar: "مدير" },
};

export const ROLE_DESCRIPTIONS: Record<Role, Localized> = {
  customer: {
    en: "A normal shopper. The admin refuses them.",
    ar: "متسوّق عادي. لا يستطيع دخول لوحة التحكم.",
  },
  staff: {
    en: "Runs the shop day to day — orders, stock, support. Cannot change who has access.",
    ar: "يدير المتجر يومياً — الطلبات والمخزون والدعم. ولا يستطيع تغيير الصلاحيات.",
  },
  admin: {
    en: "Everything staff can do, plus appointing and removing other people.",
    ar: "كل ما يفعله الموظف، بالإضافة إلى تعيين الآخرين وإزالتهم.",
  },
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.includes(value as Role);
}

export function roleLabel(role: Role, locale: Locale): string {
  return (ROLE_LABELS[role] ?? ROLE_LABELS.customer)[locale];
}

export type RoleRefusal =
  | "not-admin"
  | "bad-role"
  | "self"
  | "no-change"
  | "last-admin"
  | "unknown-account";

export interface RoleVerdict {
  ok: boolean;
  reason?: RoleRefusal;
  message: Localized;
}

function deny(reason: RoleRefusal, en: string, ar: string): RoleVerdict {
  return { ok: false, reason, message: { en, ar } };
}

/**
 * May this change be made?
 *
 * Every rule here exists because of a specific way an access screen goes
 * wrong, and each is stated once so the route cannot disagree with the form.
 */
export function canChangeRole(input: {
  callerRole: Role;
  callerUid: string;
  targetUid: string;
  /** The target's role right now. */
  targetRole: Role;
  nextRole: unknown;
  /** How many admins the project has, counting the target. */
  adminCount: number;
}): RoleVerdict {
  /*
   * Staff cannot appoint. Otherwise the distinction between the two roles is
   * decorative: anyone who could promote could promote themselves to admin,
   * and every staff account would be an admin account waiting for one click.
   */
  if (input.callerRole !== "admin") {
    return deny(
      "not-admin",
      "Only an admin can change who has access.",
      "تغيير الصلاحيات متاح للمدير فقط.",
    );
  }

  if (!isRole(input.nextRole)) {
    return deny("bad-role", "That is not a role.", "هذه ليست صلاحية معروفة.");
  }

  /*
   * No one changes their own role. An admin demoting themselves locks
   * themselves out halfway through the request that does it — and there is no
   * honest reason to do it here rather than from another admin's account.
   */
  if (input.targetUid === input.callerUid) {
    return deny(
      "self",
      "You cannot change your own role. Ask another admin.",
      "لا يمكنك تغيير صلاحيتك بنفسك. اطلب ذلك من مدير آخر.",
    );
  }

  if (input.targetRole === input.nextRole) {
    return deny(
      "no-change",
      "That account already has this role.",
      "هذا الحساب يحمل هذه الصلاحية بالفعل.",
    );
  }

  /*
   * The last admin cannot be removed. A shop with no admin has no way back in
   * short of a developer with the service-account key — which is precisely the
   * errand this screen exists to end.
   */
  if (input.targetRole === "admin" && input.nextRole !== "admin" && input.adminCount <= 1) {
    return deny(
      "last-admin",
      "This is the only admin. Appoint another one before removing this access.",
      "هذا هو المدير الوحيد. عيّن مديراً آخر قبل إزالة هذه الصلاحية.",
    );
  }

  return { ok: true, message: { en: "", ar: "" } };
}

/**
 * Does a change of role need the target signed out?
 *
 * A custom claim is baked into an ID token that stays valid for up to an hour.
 * Granting access can wait for that — the new admin refreshes and it is there.
 * **Removing** it cannot: a revoked admin would keep a working admin token for
 * the rest of the hour, which is the difference between "access removed" and
 * "access removed, soon". So a demotion revokes their refresh tokens.
 */
export function shouldRevokeTokens(from: Role, to: Role): boolean {
  const rank: Record<Role, number> = { customer: 0, staff: 1, admin: 2 };
  return rank[to] < rank[from];
}
