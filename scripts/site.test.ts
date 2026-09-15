import { strict as assert } from "node:assert";
import { test } from "node:test";

import { absoluteUrl, siteUrl } from "@/lib/site";

const withEnv = (value: string | undefined, run: () => void) => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
};

test("a trailing slash never reaches a URL", () => {
  withEnv("https://netsale.shop/", () => {
    assert.equal(siteUrl(), "https://netsale.shop");
    assert.equal(absoluteUrl("en/shop"), "https://netsale.shop/en/shop");
  });
  withEnv("https://netsale.shop///", () => {
    assert.equal(absoluteUrl("/en/shop"), "https://netsale.shop/en/shop");
  });
});

test("a leading slash on the path is not doubled", () => {
  withEnv("https://netsale.shop", () => {
    assert.equal(absoluteUrl("/en/shop"), "https://netsale.shop/en/shop");
    assert.equal(absoluteUrl("en/shop"), "https://netsale.shop/en/shop");
  });
});

test("an empty path returns the origin, not a bare slash", () => {
  withEnv("https://netsale.shop", () => {
    assert.equal(absoluteUrl(), "https://netsale.shop");
    assert.equal(absoluteUrl(""), "https://netsale.shop");
  });
});

test("the result is always absolute, whatever the environment says", () => {
  /*
   * The bug this replaced: the product page read
   * `process.env.NEXT_PUBLIC_SITE_URL ?? ""`, so an unset variable produced a
   * *relative* canonical URL in JSON-LD — which validates as present and is
   * useless to a search engine.
   */
  for (const value of [undefined, "", "   "]) {
    withEnv(value, () => {
      assert.match(siteUrl(), /^https?:\/\//, `"${String(value)}" still yields an origin`);
      assert.match(absoluteUrl("en/product/x"), /^https?:\/\/.+\/en\/product\/x$/);
    });
  }
});

test("a configured origin wins over the fallback", () => {
  withEnv("https://staging.netsale.shop", () => {
    assert.equal(siteUrl(), "https://staging.netsale.shop");
  });
});
