/**
 * QR codes, for printing on an invoice.
 *
 * Written here rather than added as a dependency, for the same reason the
 * Code 128 encoder next door is: this draws one URL on one document, and a
 * general-purpose QR package brings modes, levels and versions none of which
 * this uses. The scope is cut to exactly what an invoice needs and no further:
 *
 *  - **Byte mode only.** The payload is a URL, which is not the alphanumeric
 *    character set (that excludes lower case, `/` and `:`). Kanji and numeric
 *    modes would encode nothing this application ever produces.
 *  - **Level M.** Recovers about 15% of a damaged symbol — the print standard.
 *    L is too fragile for paper that gets folded; Q and H waste area on a
 *    document nobody is going to scan off a dirty windscreen.
 *  - **Versions 1–10**, which carry up to 213 bytes at level M. A URL longer
 *    than that is **refused rather than truncated**: a QR that scans to half a
 *    link is worse than no QR, because it looks like it worked.
 *
 * Everything here is pure, so it can be tested without a camera. It was also
 * checked the only way that really counts: every length from 1 to 213, across
 * all ten versions, encoded and then read back by an independent QR decoder.
 * That run found four bugs which each produced a symbol that looked perfectly
 * well-formed and scanned as nothing — see the comments at each of them.
 */

/* -------------------------------------------------------------------------- */
/*  GF(256) — the field Reed–Solomon works in                                 */
/* -------------------------------------------------------------------------- */

/*
 * Log and antilog tables for the field, generated once. QR uses the primitive
 * polynomial 0x11d, and multiplication becomes addition of logarithms — which
 * is the only reason the error-correction maths below is short.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * The generator polynomial for `degree` error-correction codewords.
 *
 * Coefficients run from the **leading** term down, so `poly[0]` is always 1
 * and the division below can index straight into it. Building it the other way
 * round returns the same numbers reversed, which is not obviously wrong when
 * you read it and produces error-correction bytes that no scanner accepts.
 */
export function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    // Multiply by (x + α^i): the x term keeps its index, the constant term
    // moves one place down the polynomial.
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j]! ^ poly[j]!) as number;
      next[j + 1] = (next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!)) as number;
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon remainder: the error-correction codewords for one block. */
function ecCodewords(data: number[], count: number): number[] {
  const generator = generatorPoly(count);
  const remainder = new Array<number>(count).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < count; i += 1) {
      remainder[i] = (remainder[i]! ^ gfMul(generator[i + 1]!, factor)) as number;
    }
  }

  return remainder;
}

/* -------------------------------------------------------------------------- */
/*  Version tables (level M, byte mode)                                       */
/* -------------------------------------------------------------------------- */

interface VersionSpec {
  version: number;
  /** Total data codewords across every block. */
  dataCodewords: number;
  /** Error-correction codewords per block. */
  ecPerBlock: number;
  /** [blocks in group 1, data codewords each, blocks in group 2, each]. */
  groups: [number, number, number, number];
}

/**
 * Levels for versions 1–10 at error-correction level M, from the QR standard.
 *
 * Only level M is here because only level M is offered. A table carrying four
 * levels would be four times the chance of a transcription error in numbers
 * nobody can eyeball.
 */
const VERSIONS: VersionSpec[] = [
  { version: 1, dataCodewords: 16, ecPerBlock: 10, groups: [1, 16, 0, 0] },
  { version: 2, dataCodewords: 28, ecPerBlock: 16, groups: [1, 28, 0, 0] },
  { version: 3, dataCodewords: 44, ecPerBlock: 26, groups: [1, 44, 0, 0] },
  { version: 4, dataCodewords: 64, ecPerBlock: 18, groups: [2, 32, 0, 0] },
  { version: 5, dataCodewords: 86, ecPerBlock: 24, groups: [2, 43, 0, 0] },
  { version: 6, dataCodewords: 108, ecPerBlock: 16, groups: [4, 27, 0, 0] },
  { version: 7, dataCodewords: 124, ecPerBlock: 18, groups: [4, 31, 0, 0] },
  { version: 8, dataCodewords: 154, ecPerBlock: 22, groups: [2, 38, 2, 39] },
  { version: 9, dataCodewords: 182, ecPerBlock: 22, groups: [3, 36, 2, 37] },
  { version: 10, dataCodewords: 216, ecPerBlock: 26, groups: [4, 43, 1, 44] },
];

/** Where the alignment patterns sit, per version. */
const ALIGNMENT: number[][] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

export const QR_MAX_BYTES = 213;

/* -------------------------------------------------------------------------- */
/*  Encoding                                                                  */
/* -------------------------------------------------------------------------- */

export interface QrCode {
  /** `size × size` booleans, true where the module is dark. */
  modules: boolean[][];
  size: number;
  version: number;
  text: string;
}

/**
 * Encode `text` as a QR code, or `undefined` when it will not fit.
 *
 * Undefined rather than a truncated symbol: a QR that scans to half a URL
 * looks like it worked and sends somebody to a 404, which is strictly worse
 * than an invoice with no QR on it at all.
 */
export function qrEncode(text: string): QrCode | undefined {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length === 0) return undefined;

  const spec = VERSIONS.find((candidate) => fitsIn(candidate, bytes.length));
  if (!spec) return undefined;

  const codewords = buildCodewords(spec, bytes);
  const size = spec.version * 4 + 17;

  /*
   * Eight mask patterns are tried and the least penalised wins. This is not
   * optional polish: an unmasked symbol can contain runs that look like finder
   * patterns, and a scanner will fail on it or read it wrong.
   */
  let best: { modules: boolean[][]; penalty: number } | undefined;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = draw(spec, size, codewords, mask);
    const penalty = penaltyOf(modules, size);
    if (!best || penalty < best.penalty) best = { modules, penalty };
  }

  return { modules: best!.modules, size, version: spec.version, text };
}

/** Does this version hold `length` bytes, including mode and length headers? */
function fitsIn(spec: VersionSpec, length: number): boolean {
  // 4 bits of mode + 8 bits of length (versions 1–9) or 16 (version 10+).
  const headerBits = 4 + (spec.version < 10 ? 8 : 16);
  return headerBits + length * 8 <= spec.dataCodewords * 8;
}

/** Data bits, padded, split into blocks, interleaved with their EC bytes. */
function buildCodewords(spec: VersionSpec, bytes: number[]): number[] {
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, spec.version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  // Terminator, then pad to a byte boundary.
  const capacity = spec.dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  // The standard's alternating pad bytes, until the version is full.
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j]!;
    data.push(byte);
  }
  /*
   * The alternation starts at 0xEC every time, counted from the first pad —
   * not from the payload's own length. Keying it off `data.length` makes a
   * seven-byte payload start padding with 0x11, and every codeword after it is
   * a byte the decoder was not expecting.
   */
  const PADS = [0xec, 0x11];
  for (let i = 0; data.length < spec.dataCodewords; i += 1) data.push(PADS[i % 2]!);

  /*
   * Blocks, then interleaving. A symbol's codewords are not stored in reading
   * order: they are taken one byte at a time from each block in turn, so that
   * a coffee ring destroys a little of every block rather than all of one.
   */
  const [g1Blocks, g1Size, g2Blocks, g2Size] = spec.groups;
  const blocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < g1Blocks; i += 1) {
    blocks.push(data.slice(offset, offset + g1Size));
    offset += g1Size;
  }
  for (let i = 0; i < g2Blocks; i += 1) {
    blocks.push(data.slice(offset, offset + g2Size));
    offset += g2Size;
  }

  const ecBlocks = blocks.map((block) => ecCodewords(block, spec.ecPerBlock));

  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]!);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]!);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Drawing                                                                   */
/* -------------------------------------------------------------------------- */

type Grid = (boolean | null)[][];

function draw(spec: VersionSpec, size: number, codewords: number[], mask: number): boolean[][] {
  const grid: Grid = Array.from({ length: size }, () => new Array(size).fill(null));

  const set = (row: number, col: number, dark: boolean) => {
    if (row >= 0 && row < size && col >= 0 && col < size) grid[row]![col] = dark;
  };

  // Finder patterns, with their separators.
  for (const [r, c] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const inner = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(r + dr, c + dc, inner && (ring || core));
      }
    }
  }

  // Timing patterns — the alternating row and column scanners use to find the
  // module grid.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Alignment patterns, skipping the corners the finders already own.
  const centres = ALIGNMENT[spec.version] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      const onFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // The dark module, which is always dark, always here.
  set(size - 8, 8, true);

  /*
   * Reserve the format areas so data placement skips them — and reserve
   * exactly them.
   *
   * The two runs are different lengths, which is easy to miss: nine cells
   * around the top-left finder, but only eight on each of the other two arms.
   * Running all four to nine steals `(8, size - 9)` and `(size - 9, 8)` from
   * the data region, so 206 bits are placed where 208 belong and every
   * codeword after the first fifteen lands one cell early. The symbol looks
   * perfectly well-formed and decodes to nothing.
   */
  const reserved: [number, number][] = [];
  for (let i = 0; i <= 8; i += 1) reserved.push([8, i], [i, 8]);
  for (let i = 0; i <= 7; i += 1) reserved.push([8, size - 1 - i], [size - 1 - i, 8]);
  /*
   * Version 7 and above carry an 18-bit version block in two 3×6 corners.
   * Reserved *and* written — a symbol that leaves the area to data placement
   * has both the version wrong and six codewords in the wrong cells.
   */
  if (spec.version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      reserved.push([r, c], [c, r]);
    }
  }
  for (const [r, c] of reserved) if (grid[r]![c] === null) grid[r]![c] = false;

  /*
   * Data placement: two columns at a time, right to left, snaking up then
   * down, skipping column 6 which is the vertical timing pattern.
   */
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    /*
     * Column 6 is the vertical timing pattern and is not part of any pair —
     * so the whole run shifts left by one once it is reached, rather than the
     * pair straddling it. Writing `right === 6 ? right - 1 : right` instead
     * lets the next iteration reuse a column that has already been filled,
     * which silently drops a codeword and produces a symbol no scanner reads.
     */
    if (right === 6) right = 5;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (grid[row]![c] !== null) continue;
        const byte = codewords[bitIndex >> 3] ?? 0;
        const bit = (byte >> (7 - (bitIndex & 7))) & 1;
        bitIndex += 1;
        grid[row]![c] = Boolean(bit) !== maskAt(mask, row, c);
      }
    }
    upward = !upward;
  }

  // Format information: level M with the chosen mask, BCH-protected.
  writeFormat(grid, size, mask);
  if (spec.version >= 7) writeVersion(grid, size, spec.version);

  return grid.map((row) => row.map((cell) => cell === true));
}

/** The mask condition. True means "flip this module". */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/**
 * The 15-bit format string, written twice.
 *
 * Twice because it is the one thing a scanner must read before it can read
 * anything else — lose it and the symbol is undecodable however clean the
 * data is.
 */
function writeFormat(grid: Grid, size: number, mask: number) {
  const LEVEL_M = 0b00;
  let value = (LEVEL_M << 3) | mask;
  let bch = value << 10;
  for (let i = 4; i >= 0; i -= 1) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  value = ((value << 10) | bch) ^ 0b101010000010010;

  /*
   * Bit 14 is the most significant, and the standard lays the string out
   * starting from it. Writing bit 0 into `(8, 0)` instead mirrors the whole
   * 15-bit string — the symbol still looks plausible and no scanner can read
   * it, because the format block is the first thing one decodes.
   */
  const bitAt = (i: number) => Boolean((value >> i) & 1);

  // Copy one, around the top-left finder.
  for (let i = 0; i <= 5; i += 1) grid[8]![i] = bitAt(14 - i);
  grid[8]![7] = bitAt(8);
  grid[8]![8] = bitAt(7);
  grid[7]![8] = bitAt(6);
  for (let i = 0; i <= 5; i += 1) grid[i]![8] = bitAt(i);

  /*
   * Copy two. The vertical run stops at bit 8 / `(size - 7, 8)`, because
   * `(size - 8, 8)` is the dark module — a cell the standard fixes as always
   * dark, and one a scanner checks before it trusts the rest of the symbol.
   */
  for (let i = 0; i <= 6; i += 1) grid[size - 1 - i]![8] = bitAt(14 - i);
  for (let i = 0; i <= 7; i += 1) grid[8]![size - 8 + i] = bitAt(7 - i);
}

/**
 * The 18-bit version block, for version 7 and above.
 *
 * Six data bits and a twelve-bit BCH remainder, written into two corners so a
 * scanner can size the grid without counting modules across a symbol that may
 * be skewed.
 */
function writeVersion(grid: Grid, size: number, version: number) {
  let bch = version << 12;
  for (let i = 5; i >= 0; i -= 1) {
    if (bch & (1 << (i + 12))) bch ^= 0b1111100100101 << i;
  }
  const value = (version << 12) | bch;

  for (let i = 0; i < 18; i += 1) {
    const bit = Boolean((value >> i) & 1);
    const r = Math.floor(i / 3);
    const c = size - 11 + (i % 3);
    grid[r]![c] = bit;
    grid[c]![r] = bit;
  }
}

/* -------------------------------------------------------------------------- */
/*  Mask penalties                                                            */
/* -------------------------------------------------------------------------- */

/** The standard's four penalty rules, summed. Lower is a better mask. */
function penaltyOf(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: runs of five or more of the same colour, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const line of [modules[i]!, modules.map((row) => row[i]!)]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (line[j] === line[j - 1]) {
          run += 1;
          if (run === 5) penalty += 3;
          else if (run > 5) penalty += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2: solid 2×2 blocks.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const first = modules[r]![c];
      if (
        modules[r]![c + 1] === first &&
        modules[r + 1]![c] === first &&
        modules[r + 1]![c + 1] === first
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: patterns that look like a finder, which is how a scanner gets lost.
  const FINDER = [true, false, true, true, true, false, true];
  const matches = (line: boolean[], at: number) => {
    for (let i = 0; i < 7; i += 1) if (line[at + i] !== FINDER[i]) return false;
    const before = line.slice(Math.max(0, at - 4), at);
    const after = line.slice(at + 7, at + 11);
    const quiet = (part: boolean[]) => part.length >= 4 && part.every((cell) => !cell);
    return quiet(before) || quiet(after);
  };
  for (let i = 0; i < size; i += 1) {
    const row = modules[i]!;
    const col = modules.map((r) => r[i]!);
    for (let j = 0; j + 7 <= size; j += 1) {
      if (matches(row, j)) penalty += 40;
      if (matches(col, j)) penalty += 40;
    }
  }

  // Rule 4: the balance of dark to light across the whole symbol.
  const dark = modules.flat().filter(Boolean).length;
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return penalty;
}
