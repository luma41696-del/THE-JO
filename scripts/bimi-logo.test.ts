import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

/**
 * The sender logo, against the profile mail providers actually accept.
 *
 * BIMI does not take an ordinary SVG. It takes **SVG Portable/Secure** — a
 * deliberately small subset of SVG Tiny 1.2 — and a file that misses any of it
 * is rejected wholesale. The rejection happens at the mail provider, weeks
 * after the DNS record went in, and it is not reported to anyone.
 *
 * So the rules are asserted here instead. The realistic way this breaks is not
 * somebody editing the file by hand: it is somebody re-exporting the logo from
 * a design tool, which produces a perfectly good SVG that BIMI will not take.
 *
 * Run with:
 *
 *     npm run test:bimi-logo
 */

const FILE = path.resolve(__dirname, "..", "public", "brand", "bimi-logo.svg");
const svg = fs.readFileSync(FILE, "utf8");

describe("the BIMI logo is SVG Portable/Secure", () => {
  test("it declares the tiny-ps profile", () => {
    assert.match(svg, /\bversion="1\.2"/, 'version="1.2" is required');
    assert.match(svg, /\bbaseProfile="tiny-ps"/, 'baseProfile="tiny-ps" is required');
  });

  /*
   * The title is what a screen reader announces and what some clients show on
   * hover. The spec requires it, and an export from a design tool never has it.
   */
  test("it has a title, and the title is the shop", () => {
    const title = svg.match(/<title>([^<]*)<\/title>/);
    assert.ok(title, "a <title> element is required");
    assert.equal(title[1]?.trim(), "Net Sale");
  });

  test("the viewBox is square and starts at the origin", () => {
    const box = svg.match(/viewBox="([^"]+)"/);
    assert.ok(box, "a viewBox is required");
    const [x, y, w, h] = box[1]!.trim().split(/[\s,]+/).map(Number);

    // A negative or offset origin is the usual leftover from a design tool's
    // artboard, and BIMI validators reject it.
    assert.equal(x, 0, "viewBox x must be 0");
    assert.equal(y, 0, "viewBox y must be 0");
    assert.equal(w, h, "the logo must be square — it is displayed in a circle");
  });

  test("the root carries no x, y, width or height", () => {
    const root = svg.slice(0, svg.indexOf(">") + 1);
    for (const attribute of ["x", "y", "width", "height"]) {
      assert.doesNotMatch(
        root,
        new RegExp(`\\s${attribute}="`),
        `the root <svg> must not set ${attribute}`,
      );
    }
  });

  /*
   * Everything below is refused by the profile. Each one is something a real
   * export produces: a linked bitmap, an embedded font, a tracking pixel, a
   * class attribute pointing at a stylesheet that is not there.
   */
  test("it contains nothing the profile forbids", () => {
    for (const forbidden of [
      "<script",
      "<image",
      "<foreignObject",
      "<a ",
      "<use",
      "<animate",
      "<style",
      "xlink:href",
      "href=",
      "@import",
      "data:",
    ]) {
      assert.ok(!svg.includes(forbidden), `${forbidden} is not allowed in SVG P/S`);
    }
  });

  /*
   * Transparency renders unpredictably: some clients composite onto white,
   * some onto the dark theme's own background, and a logo drawn in ink
   * disappears against one of them. A solid, opaque square is the only shape
   * that looks the same everywhere.
   */
  test("the whole square is painted, with no transparent corners", () => {
    const rect = svg.match(/<rect[^>]*>/);
    assert.ok(rect, "a background rect is required");
    assert.match(rect[0], /x="0"/);
    assert.match(rect[0], /y="0"/);
    assert.match(rect[0], /fill="#[0-9A-Fa-f]{6}"/, "the background must be a solid colour");
    // `rx` would round the corners and leave them transparent.
    assert.doesNotMatch(rect[0], /\brx=/, "rounded corners leave transparent corners");
  });

  test("it is small enough to serve", () => {
    // The spec's ceiling is 32 KB. Anything near it is a traced bitmap.
    assert.ok(Buffer.byteLength(svg, "utf8") < 32 * 1024, "must be under 32 KB");
  });

  /*
   * The mark has to survive a circular crop, which is how every client that
   * shows a BIMI logo displays it. Anything outside the inscribed circle is
   * cut off, so the drawing is kept inside it.
   */
  test("the mark stays inside the circle it will be cropped to", () => {
    const box = svg.match(/viewBox="([^"]+)"/)![1]!.trim().split(/[\s,]+/).map(Number);
    const size = box[2]!;
    const centre = size / 2;
    const radius = centre;

    const shift = svg.match(/translate\(\s*([\d.]+)[\s,]+([\d.]+)\s*\)/);
    const dx = shift ? Number(shift[1]) : 0;
    const dy = shift ? Number(shift[2]) : 0;

    // Every coordinate pair in every path, moved by the group's transform.
    const points: [number, number][] = [];
    for (const path of svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)) {
      const numbers = path[1]!.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        points.push([numbers[i]! + dx, numbers[i + 1]! + dy]);
      }
    }

    assert.ok(points.length > 20, "the paths were parsed");
    const outside = points.filter(
      ([x, y]) => Math.hypot(x - centre, y - centre) > radius,
    );
    assert.deepEqual(outside, [], "every drawn point is within the circular crop");
  });
});
