import { strict as assert } from "node:assert";
import { describe, test } from "node:test";

import { QR_MAX_BYTES, generatorPoly, qrEncode } from "../src/lib/qr";

/**
 * QR encoding.
 *
 * A QR code is not proofread by anyone. Every bug this encoder had during
 * development produced a symbol that looked perfectly well-formed to the eye
 * and scanned as nothing at all — a reversed generator polynomial, a mirrored
 * format block, pad bytes starting on the wrong value, and a reservation that
 * stole two data cells. So the tests here are not "does it return something":
 * they pin the exact output against values from the standard.
 *
 * The golden matrices below were captured after every length from 1 to 213 was
 * encoded and read back by an independent decoder. They encode the whole
 * pipeline at once — codewords, error correction, placement, mask choice and
 * format bits — so any of those four bugs breaks them.
 *
 * Run with:
 *
 *     npm run test:qr
 */

const GOLDEN = [
  {
    text: "HELLO",
    version: 1,
    rows: [
      "111111101101001111111",
      "100000100110101000001",
      "101110100111101011101",
      "101110101001001011101",
      "101110101000101011101",
      "100000101011001000001",
      "111111101010101111111",
      "000000001111100000000",
      "100010111111011111001",
      "000111001011100101111",
      "101100101011001110010",
      "111001000100011010000",
      "001011100100111000110",
      "000000001110111001011",
      "111111101100110001010",
      "100000100001100100010",
      "101110101001001110101",
      "101110100001100001011",
      "101110100111001111000",
      "100000100100011000000",
      "111111101000111110101",
    ],
  },
  {
    text: "https://netsale.shop/en/orders/NS-93GFEA",
    version: 3,
    rows: [
      "11111110101100011111101111111",
      "10000010110101001010001000001",
      "10111010010111111001101011101",
      "10111010100110111110001011101",
      "10111010011000110001001011101",
      "10000010010000100111101000001",
      "11111110101010101010101111111",
      "00000000101010100111000000000",
      "10110111000101110110001001011",
      "10110000000010000111011110001",
      "10101010001110001010100010110",
      "00101001011101100011011000001",
      "10010111001110100100100101100",
      "11000000101000110111001000111",
      "00001111111011000101110000111",
      "10010101001100100011110110010",
      "11010010011110101011110011010",
      "00000101011010000000100101110",
      "10111011010111110000000110100",
      "00101001001011111100110000100",
      "01011111110001111110111111100",
      "00000000110000011010100011111",
      "11111110100010101111101011010",
      "10000010110011110010100011001",
      "10111010011000000100111110111",
      "10111010100111010111000111001",
      "10111010100010000101000100101",
      "10000010010010000011101001010",
      "11111110101011001011101010010",
    ],
  },
];

/** Coefficients as powers of α, which is how the standard publishes them. */
function asAlphaExponents(poly: number[]): number[] {
  const exp = new Uint8Array(512);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return poly.map((c) => log[c]!);
}

describe("the generator polynomial", () => {
  /*
   * Checked against the published table rather than against itself. Built the
   * other way round it returns exactly these numbers reversed — which reads
   * fine, and makes every error-correction byte wrong.
   */
  test("matches the standard, leading coefficient first", () => {
    assert.deepEqual(
      asAlphaExponents(generatorPoly(10)),
      [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45],
    );
    assert.deepEqual(
      asAlphaExponents(generatorPoly(7)),
      [0, 87, 229, 146, 149, 238, 102, 21],
    );
    assert.deepEqual(asAlphaExponents(generatorPoly(1)), [0, 0]);
  });

  test("is monic, so the division can index straight into it", () => {
    for (const degree of [7, 10, 16, 18, 22, 24, 26]) {
      const poly = generatorPoly(degree);
      assert.equal(poly[0], 1, `degree ${degree}`);
      assert.equal(poly.length, degree + 1);
    }
  });
});

describe("encoding", () => {
  test("produces the exact matrix a scanner expects", () => {
    for (const golden of GOLDEN) {
      const qr = qrEncode(golden.text);
      assert.ok(qr, golden.text);
      assert.equal(qr.version, golden.version, golden.text);
      assert.equal(qr.size, golden.rows.length, golden.text);
      assert.deepEqual(
        qr.modules.map((row) => row.map((cell) => (cell ? "1" : "0")).join("")),
        golden.rows,
        golden.text,
      );
    }
  });

  test("the symbol is square and sized 4·version + 17", () => {
    for (const text of ["A", "A".repeat(40), "A".repeat(150)]) {
      const qr = qrEncode(text)!;
      assert.equal(qr.size, qr.version * 4 + 17);
      assert.equal(qr.modules.length, qr.size);
      for (const row of qr.modules) assert.equal(row.length, qr.size);
    }
  });

  test("the version is the smallest that fits, so the symbol stays readable", () => {
    // Version 1 holds 14 bytes at level M once the header is paid for.
    assert.equal(qrEncode("A".repeat(14))!.version, 1);
    assert.equal(qrEncode("A".repeat(15))!.version, 2);
  });

  /*
   * The three fixed patterns a scanner locks onto before it reads anything.
   * A symbol with these wrong is not a QR code at all.
   */
  test("the finder patterns are where a scanner looks for them", () => {
    const qr = qrEncode("https://netsale.shop/en/orders/NS-93GFEA")!;
    const { modules, size } = qr;
    for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
      assert.equal(modules[r]![c], true, "outer corner");
      assert.equal(modules[r + 1]![c + 1], false, "the light ring");
      assert.equal(modules[r + 3]![c + 3], true, "the solid core");
    }
  });

  test("the timing patterns alternate", () => {
    const { modules, size } = qrEncode("A".repeat(60))!;
    for (let i = 8; i < size - 8; i += 1) {
      assert.equal(modules[6]![i], i % 2 === 0, `row 6 at ${i}`);
      assert.equal(modules[i]![6], i % 2 === 0, `col 6 at ${i}`);
    }
  });

  /*
   * A cell the standard fixes as always dark. Scanners check it, and a format
   * bit written over it is a symbol that decodes to nothing.
   */
  test("the dark module is dark", () => {
    for (const text of ["A", "A".repeat(100)]) {
      const qr = qrEncode(text)!;
      assert.equal(qr.modules[qr.size - 8]![8], true, text.length.toString());
    }
  });

  test("multi-byte text is measured in bytes, not characters", () => {
    // Arabic is two bytes per letter in UTF-8; counting characters would
    // overflow the version and truncate the payload.
    const arabic = "إيصال".repeat(20);
    const qr = qrEncode(arabic)!;
    assert.ok(new TextEncoder().encode(arabic).length > arabic.length);
    assert.ok(qr.version >= 4, `version ${qr.version}`);
  });
});

describe("what it refuses", () => {
  /*
   * Undefined, never a truncated symbol. A QR that scans to half a URL looks
   * like it worked and sends somebody to a 404.
   */
  test("nothing, and more than will fit", () => {
    assert.equal(qrEncode(""), undefined);
    assert.equal(qrEncode("A".repeat(QR_MAX_BYTES + 1)), undefined);
  });

  test("the last length that fits still encodes", () => {
    const qr = qrEncode("A".repeat(QR_MAX_BYTES));
    assert.ok(qr);
    assert.equal(qr.version, 10);
  });
});
