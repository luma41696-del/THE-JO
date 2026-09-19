import "server-only";

import { blockTextFromId, firstMatch, parseRule, type IpRule } from "@/lib/security/ip";

/**
 * The blocklist, and the cache in front of it.
 *
 * This is consulted on every request that reaches the middleware, so the
 * shape of it matters more than the contents. Firestore on every page view
 * would be a read per visitor per navigation — the bill and the latency both
 * make it a non-starter — so the list is read once per instance and held for
 * `TTL`.
 *
 * ## It fails open, on purpose
 *
 * If Firestore cannot be reached, traffic is let through. A shop that goes
 * dark because its blocklist was briefly unavailable has turned a nuisance
 * into an outage, and the people it would have blocked are a handful while the
 * people it would turn away are everyone. The failure is logged; it is not
 * escalated into a closed door.
 *
 * ## The staleness is bounded and deliberate
 *
 * A block takes up to `TTL` to reach an instance already running, and a
 * removal takes the same to lift. Half a minute is short enough that an
 * operator watching the site sees their change land, and long enough that the
 * read cost is nothing. `invalidate()` clears it in the instance that made the
 * change, which is the one the operator is looking at.
 */

const TTL_MS = 30_000;

export interface BlockRecord {
  /** Canonical rule text — also the document id. */
  text: string;
  reason?: string;
  /** The account this was added alongside, when it came from a customer block. */
  uid?: string;
  addedBy?: string;
  addedAt?: number;
}

interface Cached {
  rules: IpRule[];
  records: Map<string, BlockRecord>;
  readAt: number;
}

let cache: Cached | null = null;
let inFlight: Promise<Cached> | null = null;

export function invalidate(): void {
  cache = null;
}

async function read(): Promise<Cached> {
  const { isAdminConfigured, getAdminDb } = await import("@/lib/firebase/admin");
  if (!isAdminConfigured()) return { rules: [], records: new Map(), readAt: Date.now() };

  const snap = await getAdminDb().collection("ipBlocks").limit(1000).get();

  const rules: IpRule[] = [];
  const records = new Map<string, BlockRecord>();

  for (const doc of snap.docs) {
    const data = doc.data() as Partial<BlockRecord>;
    // The stored text is canonical; the id is the same thing with `/`
    // swapped for `_`, and is the fallback for a row written without it.
    const text = data.text ?? blockTextFromId(doc.id);
    const parsed = parseRule(text);
    /*
     * A stored rule that no longer parses is skipped rather than throwing.
     * The realistic cause is the width or reserved limits being tightened
     * after the row was written, and one bad row must not stop the other
     * ninety-nine from being enforced.
     */
    if (!("rule" in parsed)) {
      console.warn(`[net sale] ignoring unparseable IP block: ${text}`);
      continue;
    }
    rules.push(parsed.rule);
    records.set(parsed.rule.text, {
      text: parsed.rule.text,
      reason: data.reason,
      uid: data.uid,
      addedBy: data.addedBy,
      addedAt: typeof data.addedAt === "number" ? data.addedAt : undefined,
    });
  }

  return { rules, records, readAt: Date.now() };
}

async function current(): Promise<Cached> {
  if (cache && Date.now() - cache.readAt < TTL_MS) return cache;

  // One read per instance even when several requests arrive at once on a cold
  // start; without this every concurrent request would fetch the collection.
  inFlight ??= read()
    .then((fresh) => {
      cache = fresh;
      return fresh;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Is this address blocked, and by which rule?
 *
 * Returns null for "no" and for "could not tell" alike — see the note about
 * failing open. The caller cannot distinguish them, which is intended: there
 * is no behaviour that should differ between the two.
 */
export async function blockFor(ip: string | null): Promise<BlockRecord | null> {
  if (!ip) return null;
  try {
    const { rules, records } = await current();
    if (rules.length === 0) return null;
    const hit = firstMatch(rules, ip);
    return hit ? (records.get(hit.text) ?? { text: hit.text }) : null;
  } catch (error) {
    console.error("[net sale] could not read the IP blocklist; letting traffic through:", error);
    return null;
  }
}

/** Every rule, for the admin screen. Not cached — it is read by one person. */
export async function listBlocks(): Promise<BlockRecord[]> {
  const { records } = await read();
  return [...records.values()].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
}
