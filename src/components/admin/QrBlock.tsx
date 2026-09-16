import { qrEncode } from "@/lib/qr";

/**
 * A QR code, drawn as one SVG path.
 *
 * One path rather than a rect per module: a version 10 symbol is 3,249
 * modules, and that many elements is a document a printer driver has to think
 * about. As a single path it is a few kilobytes and prints instantly.
 *
 * `shapeRendering="crispEdges"` matters more than it looks. Anti-aliasing a
 * module boundary puts grey along every edge, and a scanner reading a printed
 * symbol at an angle turns that grey into the wrong module.
 */
export function QrBlock({
  value,
  caption,
  size = 96,
}: {
  value: string;
  caption?: string;
  /** Rendered edge length in px. The quiet zone is drawn inside it. */
  size?: number;
}) {
  const qr = qrEncode(value);

  /*
   * Nothing at all when it will not encode, rather than an empty frame. A URL
   * too long for version 10 is a configuration problem, and a blank white box
   * on an invoice looks like a printing fault the customer should report.
   */
  if (!qr) return null;

  // Four modules of quiet zone on every side — the standard's minimum, and
  // without it a scanner cannot find the symbol's edge against the paper.
  const QUIET = 4;
  const span = qr.size + QUIET * 2;

  let path = "";
  for (let row = 0; row < qr.size; row += 1) {
    for (let col = 0; col < qr.size; col += 1) {
      if (qr.modules[row]![col]) path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }

  return (
    <figure className="flex flex-col items-center gap-1.5">
      <svg
        viewBox={`0 0 ${span} ${span}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        role="img"
        aria-label={caption ? `${caption}: ${value}` : value}
      >
        <rect width={span} height={span} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
      {caption && <figcaption className="text-mist text-[0.625rem]">{caption}</figcaption>}
    </figure>
  );
}
