"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { getIdToken } from "@/lib/firebase/auth";
import { AdminPageHeader } from "./AdminShell";
import { Panel, StatTile } from "./AdminUI";
import { Button } from "@/components/ui/Button";
import type { GiftCampaign, GiftPlay, GiftPrize } from "@/types";

/**
 * Gift campaign manager.
 *
 * The odds panel is the important part. Weights are relative numbers, and a
 * merchant setting "10, 5, 1, 1" has no intuition for what that means until
 * they see 41% / 24% / 6% / 6% written next to it — so the normalised
 * percentage is shown live as they type. Campaigns are otherwise configured
 * blind and the giveaway rate is discovered from the accounts.
 */

const STORE_TZ = "Asia/Amman";

function toLocalInput(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function fromLocalInput(value: string): number {
  if (!value) return Date.now();
  const guess = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(guess)) return Date.now();
  const drift = new Date(`${toLocalInput(guess)}:00Z`).getTime() - guess;
  return guess - drift;
}

const DAY = 86_400_000;

type PrizeDraft = GiftPrize & { issued: number };

function blankPrizes(): PrizeDraft[] {
  return [
    {
      id: "p1",
      label: { en: "10% off", ar: "خصم ١٠٪" },
      reward: "percentage",
      value: 10,
      maxDiscount: 20,
      validForDays: 14,
      weight: 30,
      issued: 0,
    },
    {
      id: "p2",
      label: { en: "Free delivery", ar: "توصيل مجاني" },
      reward: "free-shipping",
      value: 0,
      validForDays: 14,
      weight: 25,
      issued: 0,
    },
    {
      id: "p3",
      label: { en: "5 JOD off", ar: "خصم ٥ دنانير" },
      reward: "fixed",
      value: 5,
      validForDays: 14,
      minSubtotal: 40,
      weight: 15,
      issued: 0,
    },
    {
      // A losing slice is required for the game to be honest — see the note in
      // `lib/gift.ts`.
      id: "p4",
      label: { en: "Better luck next time", ar: "حظاً أوفر" },
      reward: "none",
      value: 0,
      validForDays: 1,
      weight: 30,
      issued: 0,
    },
  ];
}

export function GiftBoard({
  campaigns,
  plays,
}: {
  campaigns: GiftCampaign[];
  plays: GiftPlay[];
}) {
  const router = useRouter();
  const active = campaigns.find((c) => c.status === "active") ?? null;
  const [editing, setEditing] = useState<GiftCampaign | null>(active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState({
    en: editing?.name.en ?? "Spin & win",
    ar: editing?.name.ar ?? "أدر واربح",
  });
  const [prizes, setPrizes] = useState<PrizeDraft[]>(
    (editing?.prizes as PrizeDraft[]) ?? blankPrizes(),
  );
  const [startsAt, setStartsAt] = useState(toLocalInput(editing?.startsAt ?? Date.now()));
  const [endsAt, setEndsAt] = useState(
    toLocalInput(editing?.endsAt ?? Date.now() + 30 * DAY),
  );
  const [cooldownHours, setCooldownHours] = useState(editing?.cooldownHours ?? 24);
  const [maxAttempts, setMaxAttempts] = useState<number | "">(editing?.maxAttempts ?? "");
  const [terms, setTerms] = useState({
    en: editing?.terms?.en ?? "",
    ar: editing?.terms?.ar ?? "",
  });
  const [status, setStatus] = useState<GiftCampaign["status"]>(editing?.status ?? "draft");

  const totalWeight = prizes.reduce((sum, p) => sum + (p.weight || 0), 0);

  const report = useMemo(() => {
    const byPrize = new Map<string, number>();
    let withCoupon = 0;
    for (const play of plays) {
      byPrize.set(play.prizeId, (byPrize.get(play.prizeId) ?? 0) + 1);
      if (play.offerId) withCoupon += 1;
    }
    return { total: plays.length, byPrize, withCoupon };
  }, [plays]);

  function setPrize(index: number, patch: Partial<PrizeDraft>) {
    setPrizes((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const token = await getIdToken().catch(() => null);
      const response = await fetch("/api/admin/gift", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: editing?.id,
          name,
          kind: "wheel",
          prizes,
          startsAt: fromLocalInput(startsAt),
          endsAt: fromLocalInput(endsAt),
          cooldownHours,
          maxAttempts: maxAttempts === "" ? null : maxAttempts,
          terms: terms.en.trim() || terms.ar.trim() ? terms : null,
          status,
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; persisted?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Save failed");
      if (data.persisted === false) {
        setError("Validated, but not stored: Firebase Admin is not configured here.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The campaign could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Gift game"
        description="A wheel that issues real coupons. The server decides every spin."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Spins" value={report.total.toLocaleString("en-GB")} emphasis={report.total > 0} />
        <StatTile label="Coupons issued" value={report.withCoupon.toLocaleString("en-GB")} />
        <StatTile
          label="Win rate"
          value={report.total > 0 ? `${Math.round((report.withCoupon / report.total) * 100)}%` : "—"}
        />
        <StatTile label="Campaigns" value={campaigns.length.toString()} />
      </div>

      {error && (
        <p role="alert" className="text-alert mb-3 text-[0.8125rem]">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Panel title="Prizes and odds" description="Weights are relative; the share is shown live.">
          <ul className="space-y-3">
            {prizes.map((prize, index) => {
              const share = totalWeight > 0 ? prize.weight / totalWeight : 0;
              const issued = report.byPrize.get(prize.id) ?? 0;
              const soldOut = prize.quantity !== undefined && (prize.issued ?? 0) >= prize.quantity;

              return (
                <li key={prize.id} className="border-line rounded-md border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                    <label className="block">
                      <span className="text-mist mb-1 block text-[0.6875rem]">Label (EN)</span>
                      <input
                        value={prize.label.en}
                        onChange={(e) =>
                          setPrize(index, { label: { ...prize.label, en: e.target.value } })
                        }
                        className={input}
                      />
                    </label>

                    <label className="block">
                      <span className="text-mist mb-1 block text-[0.6875rem]">Reward</span>
                      <select
                        value={prize.reward}
                        onChange={(e) =>
                          setPrize(index, { reward: e.target.value as GiftPrize["reward"] })
                        }
                        className={input}
                      >
                        <option value="percentage">% off</option>
                        <option value="fixed">JOD off</option>
                        <option value="free-shipping">Free delivery</option>
                        <option value="none">No prize</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-mist mb-1 block text-[0.6875rem]">Value</span>
                      <input
                        type="number"
                        min={0}
                        value={prize.value}
                        disabled={prize.reward === "none" || prize.reward === "free-shipping"}
                        onChange={(e) => setPrize(index, { value: Number(e.target.value) })}
                        className={cn(input, "w-20 disabled:opacity-40")}
                      />
                    </label>

                    <label className="block">
                      <span className="text-mist mb-1 block text-[0.6875rem]">Weight</span>
                      <input
                        type="number"
                        min={0}
                        value={prize.weight}
                        onChange={(e) => setPrize(index, { weight: Number(e.target.value) })}
                        className={cn(input, "w-20")}
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem]">
                    <span className={cn("font-semibold tabular-nums", share > 0 ? "text-brand" : "text-mist")}>
                      {(share * 100).toFixed(1)}% chance
                    </span>
                    <label className="text-mist flex items-center gap-1.5">
                      Limit
                      <input
                        type="number"
                        min={0}
                        placeholder="∞"
                        value={prize.quantity ?? ""}
                        onChange={(e) =>
                          setPrize(index, {
                            quantity: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        className="border-line bg-paper w-16 rounded-sm border px-1.5 py-0.5 tabular-nums"
                      />
                    </label>
                    <span className="text-mist tabular-nums">
                      issued {prize.issued ?? 0}
                      {prize.quantity !== undefined && ` / ${prize.quantity}`}
                    </span>
                    <span className="text-mist tabular-nums">won {issued}×</span>
                    {soldOut && <span className="text-alert font-semibold">exhausted</span>}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-mist mt-3 text-[0.6875rem]">
            A losing slice keeps the game honest — a wheel where every spin wins
            is a discount with extra steps, and hiding the losing slice would
            make the odds a lie.
          </p>
        </Panel>

        <Panel title="Campaign" description="One campaign runs at a time.">
          <div className="grid gap-3">
            <Field label="Name (EN)" value={name.en} onChange={(v) => setName({ ...name, en: v })} />
            <Field
              label="الاسم (عربي)"
              value={name.ar}
              onChange={(v) => setName({ ...name, ar: v })}
              rtl
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Starts (Amman)</span>
                <input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className={input}
                />
              </label>
              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Ends (Amman)</span>
                <input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className={input}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Hours between spins</span>
                <input
                  type="number"
                  min={0}
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(Number(e.target.value))}
                  className={input}
                />
              </label>
              <label className="block">
                <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Total spins each</span>
                <input
                  type="number"
                  min={1}
                  placeholder="∞"
                  value={maxAttempts}
                  onChange={(e) =>
                    setMaxAttempts(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className={input}
                />
              </label>
            </div>

            <Field
              label="Terms (EN)"
              value={terms.en}
              onChange={(v) => setTerms({ ...terms, en: v })}
              multiline
            />
            <Field
              label="الشروط (عربي)"
              value={terms.ar}
              onChange={(v) => setTerms({ ...terms, ar: v })}
              multiline
              rtl
            />

            <label className="block">
              <span className="text-ink-muted mb-1.5 block text-[0.75rem]">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as GiftCampaign["status"])}
                className={input}
              >
                <option value="draft">Draft — not running</option>
                <option value="active">Live — customers can play</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
              <span className="text-mist mt-1 block text-[0.6875rem]">
                Making this live pauses any other running campaign.
              </span>
            </label>

            <div className="flex justify-end">
              <Button variant="brand" size="sm" loading={saving} onClick={save}>
                {editing ? "Save campaign" : "Create campaign"}
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      {campaigns.length > 0 && (
        <div className="mt-4">
          <Panel title="All campaigns" padded={false}>
            <ul className="divide-line divide-y">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex flex-wrap items-center gap-3 p-4">
                  <button
                    type="button"
                    onClick={() => setEditing(campaign)}
                    className="min-w-0 flex-1 text-start"
                    data-cursor="hover"
                  >
                    <span className="text-ink block truncate text-[0.875rem] font-medium">
                      {campaign.name.en}
                    </span>
                    <span className="text-mist block text-[0.75rem] tabular-nums">
                      {formatDate(campaign.startsAt)} → {formatDate(campaign.endsAt)} ·{" "}
                      {campaign.prizes.length} slices
                    </span>
                  </button>
                  <span
                    className={cn(
                      "rounded-pill px-2.5 py-1 text-[0.6875rem] font-semibold",
                      campaign.status === "active"
                        ? "bg-mint/12 text-mint"
                        : "bg-paper-sunken text-mist",
                    )}
                  >
                    {campaign.status}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <p className="text-mist mt-4 max-w-2xl text-[0.75rem] leading-relaxed">
        Every spin is drawn, recorded and turned into a coupon on the server
        before the wheel starts turning — so a refresh cannot replay one, the
        browser cannot choose its prize, and a connection that drops mid-spin
        still leaves the gift in the customer&rsquo;s account. Gift codes are
        tied to the account that won them and are useless anywhere else.
      </p>
    </>
  );
}

const input =
  "border-line focus:border-brand bg-paper text-ink w-full rounded-md border px-2.5 py-1.5 text-[0.8125rem] outline-none";

function Field({
  label,
  value,
  onChange,
  multiline = false,
  rtl = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rtl?: boolean;
}) {
  const Tag = multiline ? "textarea" : "input";
  return (
    <label className="block">
      <span className="text-ink-muted mb-1.5 block text-[0.75rem]">{label}</span>
      <Tag
        dir={rtl ? "rtl" : undefined}
        rows={multiline ? 2 : undefined}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        className={input}
      />
    </label>
  );
}
