import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { ROLES, canChangeRole, isRole, roleLabel, shouldRevokeTokens } from "../src/lib/team";
import type { Role } from "../src/lib/team";

/**
 * The rules that decide who may hand out access.
 *
 * This is the one permission that bypasses every other permission, so the
 * guard is tested from the attacker's side: each case below is a way an access
 * screen is actually broken into or bricked, not a way it is meant to be used.
 *
 * Run with:
 *
 *     npm run test:team
 */

const base = {
  callerRole: "admin" as Role,
  callerUid: "admin-1",
  targetUid: "someone-else",
  targetRole: "customer" as Role,
  nextRole: "staff" as Role,
  adminCount: 2,
};

describe("canChangeRole", () => {
  test("an admin may appoint staff", () => {
    assert.equal(canChangeRole(base).ok, true);
  });

  test("staff may not appoint anybody", () => {
    /*
     * The whole point of having two roles. If staff could promote, every staff
     * account would be an admin account one click away — including promoting
     * themselves, which is the first thing a stolen staff session would do.
     */
    const verdict = canChangeRole({ ...base, callerRole: "staff" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "not-admin");
  });

  test("a customer may not appoint anybody", () => {
    assert.equal(canChangeRole({ ...base, callerRole: "customer" }).reason, "not-admin");
  });

  test("nobody changes their own role", () => {
    // Self-demotion locks you out midway through the request doing it, and
    // self-promotion is the attack the whole claim system exists to prevent.
    const verdict = canChangeRole({ ...base, targetUid: base.callerUid });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "self");
  });

  test("the last admin cannot be removed", () => {
    /*
     * A shop with no admin has no way back in except a developer with the
     * service-account key — which is the errand this screen exists to end.
     */
    const verdict = canChangeRole({
      ...base,
      targetRole: "admin",
      nextRole: "customer",
      adminCount: 1,
    });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "last-admin");
  });

  test("the second-to-last admin can be", () => {
    assert.equal(
      canChangeRole({ ...base, targetRole: "admin", nextRole: "customer", adminCount: 2 }).ok,
      true,
    );
  });

  test("demoting the last admin to staff is still removing the last admin", () => {
    // "staff" is not admin. An admin count of one going to zero is the same
    // lockout whichever lesser role it lands on.
    assert.equal(
      canChangeRole({ ...base, targetRole: "admin", nextRole: "staff", adminCount: 1 }).reason,
      "last-admin",
    );
  });

  test("a no-op is refused rather than audited as a change", () => {
    const verdict = canChangeRole({ ...base, targetRole: "staff", nextRole: "staff" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, "no-change");
  });

  test("an invented role is refused", () => {
    for (const nonsense of ["owner", "superadmin", "ADMIN", "", null, undefined, 1, {}]) {
      const verdict = canChangeRole({ ...base, nextRole: nonsense });
      assert.equal(verdict.ok, false, `"${String(nonsense)}" must not be a role`);
      assert.equal(verdict.reason, "bad-role");
    }
  });

  test("refusals are bilingual and never identical", () => {
    const refusals = [
      canChangeRole({ ...base, callerRole: "staff" }),
      canChangeRole({ ...base, targetUid: base.callerUid }),
      canChangeRole({ ...base, targetRole: "admin", nextRole: "customer", adminCount: 1 }),
    ];
    for (const verdict of refusals) {
      assert.equal(verdict.message.en.length > 0, true);
      assert.equal(verdict.message.ar.length > 0, true);
      assert.notEqual(verdict.message.ar, verdict.message.en);
    }
  });

  test("the permission check comes before everything else", () => {
    /*
     * Order matters. If the "no change" or "bad role" checks ran first, a
     * staff member probing the endpoint would learn what the target's current
     * role is from which refusal came back.
     */
    const verdict = canChangeRole({
      ...base,
      callerRole: "staff",
      targetRole: "staff",
      nextRole: "staff",
    });
    assert.equal(verdict.reason, "not-admin");
  });
});

describe("shouldRevokeTokens", () => {
  test("removing access signs them out; granting it does not", () => {
    /*
     * A claim lives inside an ID token that stays valid for up to an hour.
     * Granting can wait for the next refresh. Removing cannot — otherwise the
     * screen says "access removed" and the account keeps working for an hour.
     */
    assert.equal(shouldRevokeTokens("admin", "customer"), true);
    assert.equal(shouldRevokeTokens("admin", "staff"), true);
    assert.equal(shouldRevokeTokens("staff", "customer"), true);

    assert.equal(shouldRevokeTokens("customer", "staff"), false);
    assert.equal(shouldRevokeTokens("staff", "admin"), false);
    assert.equal(shouldRevokeTokens("customer", "admin"), false);
  });
});

describe("roles", () => {
  test("only the three known roles exist", () => {
    assert.deepEqual(ROLES, ["customer", "staff", "admin"]);
    for (const role of ROLES) assert.equal(isRole(role), true);
    for (const other of ["owner", "Admin", "", null, 3]) assert.equal(isRole(other), false);
  });

  test("every role is named in both languages", () => {
    for (const role of ROLES) {
      assert.equal(roleLabel(role, "en").length > 0, true);
      assert.equal(roleLabel(role, "ar").length > 0, true);
      assert.notEqual(roleLabel(role, "ar"), roleLabel(role, "en"));
    }
  });
});
