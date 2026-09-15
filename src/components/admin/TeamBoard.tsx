"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/providers/AuthProvider";
import { getIdToken } from "@/lib/firebase/auth";
import { ApiError, errorMessage, readJson } from "@/lib/errors";
import { ROLE_DESCRIPTIONS, roleLabel, type Role } from "@/lib/team";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPageHeader } from "./AdminShell";
import { Panel, StatTile } from "./AdminUI";
import { useAdminLocale } from "./AdminLocale";

/**
 * Access.
 *
 * Granting a role used to mean opening a terminal on a machine that holds the
 * service-account key and running `npm run grant-admin`. For the person who
 * owns the shop, that is not a permission system — it is a phone call to a
 * developer.
 *
 * The screen states two things it would be easy to leave implicit, because
 * both produce "it didn't work" otherwise:
 *
 *  - a new role only reaches somebody's browser at their next sign-in, since
 *    an ID token is minted for the hour;
 *  - removing access is immediate, because the route revokes their tokens.
 *
 * Staff see this screen read-only. Hiding it from them would protect nothing —
 * the server refuses them either way — and showing who holds access answers a
 * question staff legitimately have.
 */

interface Member {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  lastSignInAt: number | null;
  disabled: boolean;
}

interface Loaded {
  ok?: boolean;
  members?: Member[];
  admins?: number;
  accounts?: number;
  truncated?: boolean;
  callerUid?: string;
  callerRole?: Role;
}

export function TeamBoard() {
  const { t, locale, rtl } = useAdminLocale();
  const { user } = useAuth();

  const [members, setMembers] = useState<Member[] | null>(null);
  const [accounts, setAccounts] = useState(0);
  const [callerRole, setCallerRole] = useState<Role>("staff");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getIdToken().catch(() => null);
      if (!token) throw new ApiError("");

      const response = await fetch("/api/admin/team", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readJson<Loaded>(response);

      setMembers(data.members ?? []);
      setAccounts(data.accounts ?? 0);
      setCallerRole(data.callerRole ?? "staff");
      setLoadError(null);
    } catch (caught) {
      setMembers((current) => current ?? []);
      setLoadError(
        errorMessage(caught, locale, {
          en: "The team could not be read.",
          ar: "تعذّر قراءة قائمة الصلاحيات.",
        }),
      );
    }
  }, [locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = callerRole === "admin";
  const admins = (members ?? []).filter((m) => m.role === "admin").length;
  const staff = (members ?? []).filter((m) => m.role === "staff").length;

  async function change(target: { uid?: string; email?: string }, nextRole: Role) {
    const key = target.uid ?? target.email ?? "";
    setBusy(key);
    setError(null);
    setNote(null);

    try {
      const token = await getIdToken().catch(() => null);
      if (!token) throw new ApiError("");

      const response = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...target, role: nextRole }),
      });

      const data = await readJson<{ ok?: boolean; note?: string }>(response);
      setNote(data.note ?? null);
      setEmail("");
      await load();
    } catch (caught) {
      setError(
        errorMessage(caught, locale, {
          en: "The role could not be changed.",
          ar: "تعذّر تغيير الصلاحية.",
        }),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <AdminPageHeader title={t("team.title")} description={t("team.subtitle")} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatTile label={t("team.admins")} value={String(admins)} emphasis />
        <StatTile label={t("team.staff")} value={String(staff)} />
        <StatTile label={t("team.accounts")} value={accounts ? String(accounts) : "—"} />
      </div>

      {loadError && (
        <p role="alert" className="text-alert mb-4 text-[0.8125rem]">
          {loadError}
        </p>
      )}

      {!isAdmin && members !== null && (
        <p className="border-line text-smoke bg-paper-sunken mb-4 rounded-md border px-4 py-3 text-[0.8125rem]">
          {t("team.staffReadOnly")}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        {/* Who holds access */}
        <Panel padded={false}>
          {members === null ? (
            <p className="text-smoke p-8 text-center text-[0.875rem]">…</p>
          ) : members.length === 0 ? (
            <p className="text-smoke p-8 text-center text-[0.875rem]">{t("team.empty")}</p>
          ) : (
            <ul className="divide-line divide-y">
              {members.map((member) => {
                const self = member.uid === user?.uid;
                return (
                  <li
                    key={member.uid}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="text-ink flex items-center gap-2 text-[0.875rem] font-medium">
                        <span className="truncate">
                          {member.displayName || member.email || member.uid}
                        </span>
                        <span
                          className={cn(
                            "rounded-xs px-1.5 py-0.5 text-[0.625rem]",
                            member.role === "admin"
                              ? "bg-ink text-white"
                              : "bg-brand-mist text-brand-deep",
                          )}
                        >
                          {roleLabel(member.role, locale)}
                        </span>
                        {self && (
                          <span className="text-mist text-[0.625rem]">({t("team.you")})</span>
                        )}
                      </p>
                      <p className="text-mist mt-0.5 text-[0.6875rem]">
                        {member.email}
                        <span className="mx-1.5 opacity-50" aria-hidden="true">
                          ·
                        </span>
                        {t("team.lastSeen")}{" "}
                        {member.lastSignInAt ? formatDate(member.lastSignInAt) : t("team.never")}
                      </p>
                    </div>

                    {/*
                      No controls against your own row: the server refuses a
                      self-change, and a button that always fails is a worse
                      answer than no button.
                    */}
                    {isAdmin && !self && (
                      <div className="flex shrink-0 items-center gap-2">
                        {member.role === "staff" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy === member.uid}
                            onClick={() => change({ uid: member.uid }, "admin")}
                          >
                            {t("team.makeAdmin")}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy === member.uid}
                            onClick={() => change({ uid: member.uid }, "staff")}
                          >
                            {t("team.makeStaff")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busy === member.uid}
                          onClick={() => {
                            // The one destructive control on the screen, so it
                            // asks — an accidental click here locks a colleague
                            // out mid-shift.
                            if (window.confirm(t("team.confirmRemove"))) {
                              void change({ uid: member.uid }, "customer");
                            }
                          }}
                        >
                          <span className="text-alert">{t("team.remove")}</span>
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Grant */}
        <div className="flex flex-col gap-4">
          {isAdmin && (
            <Panel title={t("team.grantTitle")} description={t("team.grantHint")}>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (email.trim()) void change({ email: email.trim() }, role);
                }}
              >
                <label className="block">
                  <span className="text-eyebrow text-mist mb-1.5 block uppercase">
                    {t("team.email")}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    dir="ltr"
                    className="border-line focus:border-brand bg-paper text-ink placeholder:text-mist w-full rounded-md border px-3 py-2 text-[0.875rem] outline-none transition-colors"
                  />
                </label>

                <label className="block">
                  <span className="text-eyebrow text-mist mb-1.5 block uppercase">
                    {t("team.role")}
                  </span>
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                    className="border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-3 py-2 text-[0.875rem] outline-none transition-colors"
                  >
                    <option value="staff">{roleLabel("staff", locale)}</option>
                    <option value="admin">{roleLabel("admin", locale)}</option>
                  </select>
                  <span className="text-mist mt-1.5 block text-[0.6875rem] leading-relaxed">
                    {ROLE_DESCRIPTIONS[role][locale]}
                  </span>
                </label>

                <Button
                  type="submit"
                  variant="brand"
                  size="sm"
                  loading={busy === email.trim()}
                  disabled={!email.trim()}
                  fullWidth
                >
                  {t("team.grant")}
                </Button>
              </form>
            </Panel>
          )}

          <p
            className={cn(
              "border-line text-smoke rounded-md border px-4 py-3 text-[0.75rem] leading-relaxed",
              rtl && "text-start",
            )}
          >
            {t("team.tokenNote")}
          </p>

          {error && (
            <p role="alert" className="text-alert text-[0.8125rem]">
              {error}
            </p>
          )}
          {note && !error && (
            <p role="status" className="text-smoke bg-paper-sunken rounded-md px-4 py-3 text-[0.8125rem]">
              {note}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
