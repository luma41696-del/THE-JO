import localFont from "next/font/local";

/**
 * The shop's typefaces, defined once.
 *
 * Both layouts — the storefront under `[locale]` and the admin — used to
 * declare their own copies of these, which is how the two drifted: the admin
 * ended up on Cairo while the storefront stayed on Inter, and a rule written
 * for one silently did nothing in the other. One module, imported by both.
 *
 * ## The rule
 *
 * **Cairo is the text face, in both languages, everywhere.** Body copy,
 * product names, menus, buttons, inputs, prices, quantities, ratings, tables,
 * filters, errors, the bag, the checkout, the account, and every admin screen.
 * It carries Arabic and Latin in one family, so a bilingual page is one
 * typeface rather than two that never quite agree.
 *
 * **The display faces are for chosen headings only** — a page's own title, a
 * section opener — never for buttons, labels or table headers:
 *
 *   - Latin headings: **Quadrillion Sb**, the brand face.
 *   - Arabic headings: **Baloo Bhaijaan 2**, which is what Quadrillion cannot
 *     do — it has no Arabic glyphs at all.
 *
 * Which of the two applies is decided by the *text's* language, not the
 * page's: `globals.css` swaps `--font-display` under `[dir="rtl"]`, so an
 * Arabic heading on an English page still gets Baloo rather than falling
 * through Quadrillion's missing glyphs into a system font.
 *
 * ## Weights
 *
 * Only weights that exist as files are declared. Nothing here asks the browser
 * to synthesise a bold or an oblique: a faux-bold Arabic is a smear, and a
 * synthesised italic slants glyphs that were never drawn to slant.
 */

/**
 * Cairo — the text face.
 *
 * Preloaded, unlike the display faces: this is the first thing rendered on
 * every page in both languages, so it is the one font worth blocking for.
 * Six weights are declared and the browser fetches only the faces the page
 * actually matches.
 */
export const cairo = localFont({
  src: [
    { path: "../../public/fonts/Cairo-ExtraLight.woff2", weight: "200", style: "normal" },
    { path: "../../public/fonts/Cairo-Light.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/Cairo-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Cairo-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Cairo-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/Cairo-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-cairo",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
});

/**
 * Quadrillion Sb — Latin headings only.
 *
 * **No Arabic glyphs.** That is not a flaw to work around, it is why the
 * Arabic side of the identity is set in Baloo instead: a display face without
 * the script cannot carry the script, and per-glyph fallback into a system
 * font is worse than choosing a second face on purpose.
 */
export const quadrillion = localFont({
  src: [
    { path: "../../public/fonts/Quadrillion-Sb.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Quadrillion-SbIt.woff2", weight: "600", style: "italic" },
  ],
  variable: "--font-quadrillion",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Poppins", "ui-rounded", "system-ui", "sans-serif"],
});

/**
 * Baloo Bhaijaan 2 — Arabic headings only.
 *
 * It used to be the Arabic *text* face as well, which is the job Cairo now
 * does. Its rounded, high-contrast geometry reads as a display voice; at 15px
 * in a table it was doing work it was not drawn for.
 *
 * Not preloaded: an English page never touches it.
 */
export const baloo = localFont({
  src: [
    { path: "../../public/fonts/BalooBhaijaan2-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/BalooBhaijaan2-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/BalooBhaijaan2-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/BalooBhaijaan2-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/BalooBhaijaan2-ExtraBold.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-baloo",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  fallback: ["Segoe UI", "Tahoma", "sans-serif"],
});

/** Every font variable, for the `<html>` className. */
export const fontVariables = [cairo.variable, quadrillion.variable, baloo.variable].join(" ");
