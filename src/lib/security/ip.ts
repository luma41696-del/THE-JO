/**
 * Reading and matching client addresses.
 *
 * Pure, and deliberately so: this decides whether somebody is let into the
 * shop, and every interesting case in it is a string-parsing case that wants
 * asserting rather than trying in production.
 *
 * ## What an IP block is actually worth
 *
 * Worth saying plainly, because the feature is easy to over-trust:
 *
 *  - **A phone changes address constantly.** Mobile networks reassign, and the
 *    same person is on a different address after a walk down the street.
 *  - **Carrier-grade NAT means addresses are shared.** One public IPv4 address
 *    can sit in front of thousands of a mobile operator's subscribers, which is
 *    the normal arrangement for Jordanian mobile networks. Blocking one can
 *    block a great many people who did nothing.
 *  - **A VPN costs nothing.** This stops casual nuisance, not a determined
 *    person.
 *
 * It is still useful — it raises the cost of coming back, and it stops a
 * script immediately. It is not a substitute for blocking the account, and the
 * admin screen says so.
 *
 * ## Why IPv6 is matched on the /64 and not the address
 *
 * An IPv6 customer is not given an address, they are given a prefix — usually
 * a /64, often a /56. A device picks its own address inside it and changes it
 * routinely for privacy. Blocking the single /128 somebody happened to arrive
 * on blocks nothing an hour later, so a bare IPv6 address is widened to its
 * /64, which is the unit that identifies the connection.
 */

export type IpVersion = 4 | 6;

export interface IpRule {
  /** The canonical text, as stored and displayed: `1.2.3.0/24`, `2001:db8::/64`. */
  text: string;
  version: IpVersion;
  /** Network bytes, already masked. */
  bytes: Uint8Array;
  prefix: number;
}

/* -------------------------------------------------------------------------- */
/*  Reading the address off a request                                         */
/* -------------------------------------------------------------------------- */

/**
 * The client's address, as far as the platform will vouch for it.
 *
 * `x-forwarded-for` is a list the client can start: anybody can send
 * `X-Forwarded-For: 1.2.3.4` and a naive reader believes it. It is trustworthy
 * *here* only because Vercel overwrites it at the edge with the address it
 * actually saw, so nothing a caller sends survives.
 *
 * `x-vercel-forwarded-for` is preferred where present because the platform
 * sets it and nothing else does — behind another proxy one day, that is the
 * header that stays honest.
 */
export function clientIp(headers: Headers): string | null {
  const candidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("x-forwarded-for")?.split(",")[0],
    headers.get("x-real-ip"),
  ];

  for (const candidate of candidates) {
    const ip = normaliseIp(candidate ?? "");
    if (ip) return ip;
  }
  return null;
}

/**
 * Canonical form, or empty for anything that is not an address.
 *
 * Handles the three shapes that otherwise cause a block to silently miss:
 * a bracketed and ported address from a proxy, an IPv6 zone index, and — the
 * one that actually bites — an IPv4-mapped IPv6 address. A request arriving as
 * `::ffff:203.0.113.9` is the same machine as `203.0.113.9`, and a blocklist
 * that stores one and compares the other never matches.
 */
export function normaliseIp(value: string): string {
  let ip = value.trim().toLowerCase();
  if (!ip) return "";

  // `[2001:db8::1]:443`
  if (ip.startsWith("[")) {
    const close = ip.indexOf("]");
    if (close === -1) return "";
    ip = ip.slice(1, close);
  } else if (ip.split(":").length === 2) {
    // `1.2.3.4:5678` — exactly one colon, so it cannot be IPv6.
    ip = ip.split(":")[0]!;
  }

  // `fe80::1%eth0`
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);

  // `::ffff:203.0.113.9` and `::203.0.113.9` are IPv4 wearing a hat.
  const mapped = ip.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) ip = mapped[1]!;

  return isIpv4(ip) || isIpv6(ip) ? ip : "";
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    // `01` is rejected: a leading zero is octal in some parsers and decimal in
    // others, and an address that means two things is not one to match on.
    if (part.length > 1 && part.startsWith("0")) return false;
    return Number(part) <= 255;
  });
}

function isIpv6(value: string): boolean {
  if (!value.includes(":")) return false;
  try {
    return ipv6Bytes(value) !== null;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Bytes                                                                     */
/* -------------------------------------------------------------------------- */

function ipv4Bytes(value: string): Uint8Array | null {
  if (!isIpv4(value)) return null;
  return Uint8Array.from(value.split(".").map(Number));
}

function ipv6Bytes(value: string): Uint8Array | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const expand = (part: string): string[] => (part ? part.split(":") : []);
  const head = expand(halves[0] ?? "");
  const tail = halves.length === 2 ? expand(halves[1] ?? "") : [];

  // A trailing IPv4 form: `::ffff:1.2.3.4`, `2001:db8::1.2.3.4`.
  const groups: string[] = [];
  const pushGroup = (group: string): boolean => {
    if (group.includes(".")) {
      const four = ipv4Bytes(group);
      if (!four) return false;
      groups.push(((four[0]! << 8) | four[1]!).toString(16));
      groups.push(((four[2]! << 8) | four[3]!).toString(16));
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/.test(group)) return false;
    groups.push(group);
    return true;
  };

  const headGroups: string[] = [];
  for (const group of head) {
    groups.length = 0;
    if (!pushGroup(group)) return null;
    headGroups.push(...groups);
  }
  const tailGroups: string[] = [];
  for (const group of tail) {
    groups.length = 0;
    if (!pushGroup(group)) return null;
    tailGroups.push(...groups);
  }

  const total = headGroups.length + tailGroups.length;
  if (halves.length === 2) {
    if (total > 7) return null;
  } else if (total !== 8) {
    return null;
  }

  const middle = new Array(8 - total).fill("0");
  const all = halves.length === 2 ? [...headGroups, ...middle, ...tailGroups] : headGroups;
  if (all.length !== 8) return null;

  const bytes = new Uint8Array(16);
  all.forEach((group, i) => {
    const n = parseInt(group, 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  });
  return bytes;
}

/** The address as bytes, with its version. */
export function ipBytes(ip: string): { bytes: Uint8Array; version: IpVersion } | null {
  const value = normaliseIp(ip);
  if (!value) return null;

  const four = ipv4Bytes(value);
  if (four) return { bytes: four, version: 4 };

  const six = ipv6Bytes(value);
  return six ? { bytes: six, version: 6 } : null;
}

function mask(bytes: Uint8Array, prefix: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    const remaining = prefix - i * 8;
    if (remaining >= 8) out[i] = bytes[i]!;
    else if (remaining <= 0) out[i] = 0;
    else out[i] = bytes[i]! & (0xff << (8 - remaining));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Rules                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The narrowest block this will accept.
 *
 * A /8 is sixteen million addresses and a /16 is sixty-five thousand. Nothing
 * a shop needs to block is that wide, and the realistic way a too-wide rule
 * gets entered is a typo in a hurry.
 */
export const MIN_PREFIX = { 4: 24, 6: 48 } as const;

export type RuleProblem =
  | "empty"
  | "not-an-address"
  | "bad-prefix"
  | "too-wide"
  | "reserved";

/**
 * Parse what an operator typed into a rule, or say why not.
 *
 * A bare address is a rule for that address — except in IPv6, where it is
 * widened to its /64. See the note at the top of this file.
 */
export function parseRule(input: string): { rule: IpRule } | { problem: RuleProblem } {
  const text = input.trim().toLowerCase();
  if (!text) return { problem: "empty" };

  const [addressPart, prefixPart, ...rest] = text.split("/");
  if (rest.length > 0) return { problem: "not-an-address" };

  const parsed = ipBytes(addressPart ?? "");
  if (!parsed) return { problem: "not-an-address" };
  const { bytes, version } = parsed;

  const width = version === 4 ? 32 : 128;
  let prefix: number;

  if (prefixPart === undefined) {
    // A single IPv4 address is itself; a single IPv6 address is its /64.
    prefix = version === 4 ? 32 : 64;
  } else {
    if (!/^\d{1,3}$/.test(prefixPart)) return { problem: "bad-prefix" };
    prefix = Number(prefixPart);
    if (prefix > width) return { problem: "bad-prefix" };
  }

  if (prefix < MIN_PREFIX[version]) return { problem: "too-wide" };

  /*
   * A private or reserved range is refused outright. Blocking `10.0.0.0/8` or
   * `127.0.0.1` does nothing to a visitor and quite a lot to the shop's own
   * health checks — and `0.0.0.0/0`, which is the shape a panicked typo takes,
   * locks every customer out at once.
   */
  if (isReserved(bytes, version)) return { problem: "reserved" };

  const network = mask(bytes, prefix);
  return { rule: { text: `${formatIp(network, version)}/${prefix}`, version, bytes: network, prefix } };
}

/** Does this address fall inside this rule? */
export function ruleMatches(rule: IpRule, ip: string): boolean {
  const parsed = ipBytes(ip);
  if (!parsed || parsed.version !== rule.version) return false;
  const masked = mask(parsed.bytes, rule.prefix);
  return masked.every((byte, i) => byte === rule.bytes[i]);
}

/** The first rule that matches, or nothing. */
export function firstMatch(rules: IpRule[], ip: string): IpRule | null {
  for (const rule of rules) if (ruleMatches(rule, ip)) return rule;
  return null;
}

function formatIp(bytes: Uint8Array, version: IpVersion): string {
  if (version === 4) return Array.from(bytes).join(".");

  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push((((bytes[i]! << 8) | bytes[i + 1]!) >>> 0).toString(16));
  }

  // Collapse the longest run of zero groups, as the canonical form requires.
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i += 1) {
    if (i < groups.length && groups[i] === "0") {
      if (start === -1) start = i;
    } else if (start !== -1) {
      const length = i - start;
      if (length > bestLength && length > 1) {
        bestStart = start;
        bestLength = length;
      }
      start = -1;
    }
  }

  if (bestStart === -1) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

/**
 * Loopback, private, link-local, carrier-grade NAT and the rest.
 *
 * Refused as *rules*, not as visitors: an address in one of these ranges never
 * belongs to somebody on the internet, so a rule naming one can only be a
 * mistake — and one that would block the shop's own monitoring.
 */
function isReserved(bytes: Uint8Array, version: IpVersion): boolean {
  if (version === 4) {
    const [a, b] = [bytes[0]!, bytes[1]!];
    if (a === 0) return true; // 0.0.0.0/8 — including the whole-internet typo
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return true; // :: — the whole-internet typo, again
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // link-local
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // unique local
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true; // ::1
  return false;
}

/** Why a rule was refused, in both languages. */
export const RULE_PROBLEMS: Record<RuleProblem, { en: string; ar: string }> = {
  empty: { en: "Enter an address.", ar: "أدخل عنواناً." },
  "not-an-address": {
    en: "That is not an IP address or range.",
    ar: "هذا ليس عنوان IP أو نطاقاً.",
  },
  "bad-prefix": { en: "That prefix length is not valid.", ar: "طول البادئة غير صالح." },
  "too-wide": {
    en: `Too wide. The widest allowed is /${MIN_PREFIX[4]} for IPv4 and /${MIN_PREFIX[6]} for IPv6.`,
    ar: `النطاق واسع جداً. الأقصى المسموح /${MIN_PREFIX[4]} لـ IPv4 و /${MIN_PREFIX[6]} لـ IPv6.`,
  },
  reserved: {
    en: "That is a private or reserved range. No visitor uses one.",
    ar: "هذا نطاق خاص أو محجوز. لا يستخدمه أي زائر.",
  },
};

/* -------------------------------------------------------------------------- */
/*  Storage                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A rule as a Firestore document id.
 *
 * Firestore ids cannot contain `/`, and **every** canonical rule has one —
 * a lone address is stored as `/32` or `/64`. Using the text directly throws
 * on the first block anybody adds, which is precisely what it did.
 *
 * `_` is the substitute because neither IPv4 nor IPv6 notation can contain it,
 * so the mapping is reversible without escaping.
 */
export function blockDocId(text: string): string {
  return text.replace(/\//g, "_");
}

/** Back the other way, for a row read by its id alone. */
export function blockTextFromId(id: string): string {
  return id.replace(/_/g, "/");
}
