import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import {
  blockDocId,
  blockTextFromId,
  clientIp,
  firstMatch,
  ipBytes,
  normaliseIp,
  parseRule,
  ruleMatches,
  type IpRule,
} from "../src/lib/security/ip";

/**
 * Blocking by address.
 *
 * Every failure mode here is silent. A rule that does not match lets somebody
 * in and says nothing; a rule that matches too much locks customers out and
 * the shop hears about it as "the site is down". Neither shows up in a log
 * looking wrong, so both are pinned here.
 *
 * Run with:
 *
 *     npm run test:ip-block
 */

const rule = (text: string): IpRule => {
  const parsed = parseRule(text);
  assert.ok("rule" in parsed, `${text} should parse: ${JSON.stringify(parsed)}`);
  return parsed.rule;
};

/* -------------------------------------------------------------------------- */
/*  Reading the address                                                       */
/* -------------------------------------------------------------------------- */

describe("the address is read the way the platform sends it", () => {
  test("the platform's own header wins over the forwarded list", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      "x-real-ip": "192.0.2.5",
    });
    assert.equal(clientIp(headers), "203.0.113.9");
  });

  test("the first entry of the forwarded list is the client", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" });
    assert.equal(clientIp(headers), "203.0.113.9");
  });

  test("nothing usable is null, not a guess", () => {
    assert.equal(clientIp(new Headers()), null);
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" })), null);
  });
});

describe("normalising", () => {
  /*
   * The one that actually bites. A request can arrive as `::ffff:203.0.113.9`,
   * which is the same machine as `203.0.113.9` — and a blocklist storing one
   * and comparing the other never matches, forever, with no error.
   */
  test("an IPv4-mapped IPv6 address is the IPv4 address", () => {
    assert.equal(normaliseIp("::ffff:203.0.113.9"), "203.0.113.9");
    assert.equal(normaliseIp("::203.0.113.9"), "203.0.113.9");
    assert.equal(normaliseIp("::FFFF:203.0.113.9"), "203.0.113.9");
  });

  test("ports and brackets and zones come off", () => {
    assert.equal(normaliseIp("203.0.113.9:44310"), "203.0.113.9");
    assert.equal(normaliseIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(normaliseIp("fe80::1%eth0"), "fe80::1");
    assert.equal(normaliseIp("  203.0.113.9  "), "203.0.113.9");
  });

  test("things that are not addresses are empty", () => {
    for (const bad of ["", "hello", "999.1.1.1", "1.2.3", "1.2.3.4.5", "::ffff:999.1.1.1", "12345"]) {
      assert.equal(normaliseIp(bad), "", bad);
    }
  });

  /*
   * A leading zero is octal to some parsers and decimal to others, so
   * `010.0.0.1` means two different machines depending on who reads it. An
   * address that means two things is not one to match on.
   */
  test("a leading zero is refused rather than guessed at", () => {
    assert.equal(normaliseIp("010.0.0.1"), "");
    assert.equal(normaliseIp("192.168.01.1"), "");
  });

  test("IPv6 forms round-trip to the same bytes", () => {
    const a = ipBytes("2001:0db8:0000:0000:0000:0000:0000:0001")!;
    const b = ipBytes("2001:db8::1")!;
    assert.deepEqual(Array.from(a.bytes), Array.from(b.bytes));
    assert.equal(a.version, 6);
  });
});

/* -------------------------------------------------------------------------- */
/*  Parsing rules                                                             */
/* -------------------------------------------------------------------------- */

describe("what an operator types becomes a rule", () => {
  test("a single IPv4 address is itself", () => {
    assert.equal(rule("203.0.113.9").text, "203.0.113.9/32");
  });

  test("a CIDR is masked to its network", () => {
    // 203.0.113.9/24 is a rule about 203.0.113.0, and storing the typed host
    // would make two identical rules look different in the list.
    assert.equal(rule("203.0.113.9/24").text, "203.0.113.0/24");
  });

  /*
   * An IPv6 customer is given a prefix, not an address, and their device
   * changes its address inside it routinely for privacy. A /128 blocks
   * nothing an hour later.
   */
  test("a bare IPv6 address is widened to its /64", () => {
    const parsed = rule("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    assert.equal(parsed.prefix, 64);
    assert.equal(parsed.text, "2001:db8:1:2::/64");
  });

  test("an explicit IPv6 prefix is kept", () => {
    assert.equal(rule("2001:db8::/56").prefix, 56);
  });
});

describe("rules that would do harm are refused", () => {
  const problem = (text: string) => {
    const parsed = parseRule(text);
    assert.ok("problem" in parsed, `${text} should be refused`);
    return parsed.problem;
  };

  /*
   * The shape a panicked typo takes. `0.0.0.0/0` is every address there is.
   *
   * It is refused twice over — the width check catches it first, the reserved
   * check would catch it anyway — so what is asserted is that it is refused,
   * not which guard got there first. Pinning the reason would make this test
   * fail if the checks were ever reordered, which would be a false alarm.
   */
  test("the whole internet is not a rule", () => {
    for (const everything of ["0.0.0.0/0", "::/0", "0.0.0.0/24", "0.0.0.0"]) {
      assert.ok("problem" in parseRule(everything), everything);
    }
  });

  test("a range wider than the limit is refused", () => {
    assert.equal(problem("203.0.113.0/8"), "too-wide");
    assert.equal(problem("203.0.113.0/16"), "too-wide");
    assert.equal(problem("2001:db8::/32"), "too-wide");
    // The edge of what is allowed still works.
    assert.equal(rule("203.0.113.0/24").prefix, 24);
    assert.equal(rule("2001:db8::/48").prefix, 48);
  });

  /*
   * Blocking these does nothing to a visitor and quite a lot to the shop's own
   * health checks.
   */
  test("private, loopback and carrier-NAT ranges are refused", () => {
    for (const reserved of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.1.1",
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
    ]) {
      assert.equal(problem(reserved), "reserved", reserved);
    }
  });

  test("nonsense is named as nonsense", () => {
    assert.equal(problem(""), "empty");
    assert.equal(problem("hello"), "not-an-address");
    assert.equal(problem("203.0.113.9/abc"), "bad-prefix");
    assert.equal(problem("203.0.113.9/33"), "bad-prefix");
    assert.equal(problem("203.0.113.9/24/8"), "not-an-address");
  });
});

/* -------------------------------------------------------------------------- */
/*  Matching                                                                  */
/* -------------------------------------------------------------------------- */

describe("matching", () => {
  test("a single address matches only itself", () => {
    const r = rule("203.0.113.9");
    assert.ok(ruleMatches(r, "203.0.113.9"));
    assert.ok(!ruleMatches(r, "203.0.113.10"));
    assert.ok(!ruleMatches(r, "203.0.114.9"));
  });

  test("a /24 matches its whole block and nothing beyond", () => {
    const r = rule("203.0.113.0/24");
    assert.ok(ruleMatches(r, "203.0.113.0"));
    assert.ok(ruleMatches(r, "203.0.113.255"));
    assert.ok(!ruleMatches(r, "203.0.114.0"));
    assert.ok(!ruleMatches(r, "203.0.112.255"));
  });

  test("a /64 matches every address a device picks inside it", () => {
    const r = rule("2001:db8:1:2::/64");
    assert.ok(ruleMatches(r, "2001:db8:1:2::1"));
    assert.ok(ruleMatches(r, "2001:db8:1:2:ffff:ffff:ffff:ffff"));
    assert.ok(!ruleMatches(r, "2001:db8:1:3::1"));
  });

  /*
   * The mapped-address trap, from the matching side: a rule typed as IPv4 has
   * to catch the same machine arriving in IPv6 clothing.
   */
  test("an IPv4 rule catches the mapped form of the same address", () => {
    assert.ok(ruleMatches(rule("203.0.113.9"), "::ffff:203.0.113.9"));
    assert.ok(ruleMatches(rule("203.0.113.0/24"), "::ffff:203.0.113.77"));
  });

  test("the two families never match each other", () => {
    assert.ok(!ruleMatches(rule("203.0.113.0/24"), "2001:db8::1"));
    assert.ok(!ruleMatches(rule("2001:db8::/64"), "203.0.113.9"));
  });

  test("an unreadable address matches nothing", () => {
    for (const bad of ["", "hello", "999.1.1.1"]) {
      assert.ok(!ruleMatches(rule("203.0.113.0/24"), bad), bad);
    }
  });

  test("the first matching rule is the one reported", () => {
    const rules = [rule("198.51.100.0/24"), rule("203.0.113.0/24")];
    assert.equal(firstMatch(rules, "203.0.113.9")?.text, "203.0.113.0/24");
    assert.equal(firstMatch(rules, "192.0.2.1"), null);
    assert.equal(firstMatch([], "203.0.113.9"), null);
  });
});

/* -------------------------------------------------------------------------- */
/*  Storing                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * Found by adding a block and watching it throw.
 *
 * Firestore document ids cannot contain `/`, and **every** canonical rule has
 * one — even a lone address is stored as `/32`. Writing the rule text straight
 * into `doc()` failed on the first block anybody added, which meant the whole
 * feature was broken and the unit tests above were all still green.
 */
describe("a rule survives being a document id", () => {
  test("the slash is swapped for something an id may contain", () => {
    assert.equal(blockDocId("203.0.113.0/24"), "203.0.113.0_24");
    assert.ok(!blockDocId("203.0.113.0/24").includes("/"));
    assert.ok(!blockDocId("2001:db8::/64").includes("/"));
  });

  test("every shape of rule round-trips", () => {
    for (const text of [
      "203.0.113.9/32",
      "203.0.113.0/24",
      "2001:db8::/64",
      "2001:db8:1:2::/64",
      "2001:db8::/48",
    ]) {
      assert.equal(blockTextFromId(blockDocId(text)), text, text);
      // And the round-tripped text still parses back to the same rule.
      const again = parseRule(blockTextFromId(blockDocId(text)));
      assert.ok("rule" in again, text);
      assert.equal(again.rule.text, text);
    }
  });

  test("no rule text can contain the character used for the swap", () => {
    // `_` is the substitute precisely because neither family's notation uses
    // it. If that stopped being true the mapping would stop being reversible.
    for (const text of ["203.0.113.0/24", "2001:db8:1:2::/64", "203.0.113.9/32"]) {
      assert.ok(!text.replace(/\//g, "").includes("_"), text);
    }
  });
});
