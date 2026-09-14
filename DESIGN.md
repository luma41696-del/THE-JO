# THE JO | ذاجو — Design & Architecture

The complete brief: concept, visual system, UX architecture, motion system, page
breakdown, technical architecture, folder structure, Firebase structure.

Everything below is implemented in this repository — the file paths are real
and the tokens are the ones the site actually renders from.

---

## 1. Concept

### The idea the logo gives you

The mark is an organic pebble — a **bubble** — with a violet `Jo` monogram
inside it and a small **detached dot** sitting outside, bottom-right. That dot
is the whole brand in one detail: it is a speech-bubble tail, a full stop, and a
pointer all at once.

So the concept is: **a soft, living surface with one precise point.**

That reads three ways across the product:

| Brand element | Interface consequence |
| --- | --- |
| Organic bubble | Generous radii, floating panels, nothing hard-edged |
| Wave / ripple | Ambient motion, the Lottie, the loading and empty states |
| The precise dot | The cursor's real pointer, the violet accent, the single CTA per screen |

### Positioning

Not "luxury" in the gold-serif sense — **considered**. Twelve pieces a season,
Italian mills, built to outlast the season. The copy throughout names specifics
(`88% virgin wool, 12% cashmere`, `Biella, Italy`, `14-gauge`) because a premium
fashion brand earns trust with facts, not adjectives.

The tone is confident and plain. `Buy less. Choose well. Make it last.`

### What makes it different from the reference

The reference gives a clean floating panel and a right-side control rail. Rather
than copying the sidebar, THE JO reinterprets it: the hero's right column is a
**live merchandising panel** — real, shoppable product cards floating over a
campaign plate, parallaxing at different rates. The first screen is a shop, not
a decoration.

---

## 2. Visual system

### 2.1 Colour

Taken directly from the artwork (`#703BEC` sampled from the master logo), then
extended into a working palette. Defined in `src/app/globals.css` under
`@theme`.

| Token | Hex | Role |
| --- | --- | --- |
| `violet` | `#703BEC` | Brand signature. The single primary CTA, links, active state |
| `violet-deep` | `#4B21B0` | Pressed / hover on violet surfaces |
| `violet-bright` | `#8B5CF6` | Violet on dark grounds, where `#703BEC` goes muddy |
| `violet-mist` | `#F0EAFF` | Tinted surfaces, chips |
| `violet-veil` | `#FAF7FF` | Whole-section wash |
| `ink` | `#0B0B0F` | Text, the dark ground, primary buttons |
| `ink-soft` | `#1A1A22` | Hover on ink |
| `ink-muted` | `#4A4A55` | Body copy |
| `smoke` | `#6B6B76` | Secondary copy |
| `mist` | `#9D9DA8` | Tertiary, metadata |
| `paper` | `#FAF8F4` | Page ground |
| `paper-raised` | `#FFFFFF` | Cards |
| `paper-sunken` | `#F2EFE9` | Image wells, skeletons |
| `line` / `line-strong` | `#E6E2DA` / `#D5D0C5` | Hairlines |
| `sand` / `clay` | `#E9DFD2` / `#C8A68A` | Editorial accents |
| `coral` | `#FF4F3D` | **Sale and scarcity only** |
| `mint` | `#14A07A` | **In stock and success only** |

Three rules that hold the palette together:

1. **The ground is bone, not white.** `#FAF8F4` rather than `#FFFFFF`. Pure
   white makes fashion photography look clinical and makes the violet look
   cheap. The warmth is what reads as expensive.
2. **Violet is rationed.** One violet CTA per screen. When everything is the
   brand colour, nothing is.
3. **Coral and mint mean something.** Coral is never decoration — it is always
   a reduction or a scarcity signal. Mint is never decoration — it is always
   confirmation. A customer learns this in two screens and then trusts it.

### 2.2 Typography

Four roles, two scripts.

| Token | Face | Where |
| --- | --- | --- |
| `font-display` | **Quadrillion Sb** → Baloo | Wordmark and headlines |
| `font-ui` | **Baloo Bhaijaan 2** | Buttons, badges, chips, nav, labels — in *both* scripts |
| `font-sans` | **Inter** → Baloo | Everything read at length, in Latin |
| `font-arabic` | **Baloo Bhaijaan 2** | All Arabic copy |
| `font-editorial` | **Instrument Serif** italic | Pull quotes and the closing line (Latin only) |

Three decisions do the work here:

**Quadrillion is the logo face**, so using it for headlines makes the wordmark
feel native to the page rather than pasted on. It is explicitly never used for
body copy — a geometric display face at 15px on a product description is
unreadable, and it was not drawn for that.

**`font-display` lists Quadrillion first and Baloo second.** Quadrillion carries
no Arabic glyphs, so the browser's own per-glyph fallback does the bilingual work
for free: Latin headings set in the logo face, Arabic headings set in Baloo, from
one token and with no conditional CSS.

**Baloo covers Arabic *and* the interface chrome in English.** Buttons, badges
and chips read as one family whichever language the shopper is in, which is what
stops a bilingual interface from feeling like two different products. Its rounded
geometry also sits naturally beside the pebble mark.

Loaded via `next/font` in `src/app/[locale]/layout.tsx`: `localFont` for
Quadrillion (72KB → 39KB woff2) and Baloo (5 weights, ~60KB each), Google fonts
for Inter and Instrument Serif. All self-hosted, all `display: swap`.

Baloo is declared with **`preload: false`** on purpose. Five weights with full
Arabic coverage is ~300KB, and preloading all of them would block first paint to
fetch weights a page may never use. Without preload the browser requests only the
faces its rendered text actually matches, and the files carry a one-year
immutable cache, so the cost is paid once.

**Scale** (fluid, clamped — `globals.css`):

```
hero     clamp(2.75rem, 8vw, 7rem)     lh 0.92   ls -0.04em
display  clamp(2rem, 4.5vw, 3.75rem)   lh 1.02   ls -0.03em
eyebrow  0.6875rem                     lh 1      ls  0.22em   UPPERCASE
body     0.9375rem / 1.0625rem
```

Tight negative tracking on display sizes, very wide positive tracking on
eyebrows. That contrast is most of what makes a type system look designed.

**Bilingual pairing.** Where the two scripts appear together, Arabic sits
*beneath* the Latin at a smaller optical size, never beside it at the same size —
Arabic letterforms carry more visual weight per character, so matching the point
size starves the Latin.

In Arabic mode, three things change automatically in `globals.css`:

- body copy switches to Baloo and gets looser leading (1.75), because Inter has
  no Arabic coverage and inheriting its metrics leaves Arabic sitting badly in
  its box;
- headings go to **weight 800 with neutral tracking** — the Latin display face
  reaches for presence through tight tracking and a condensed geometry, neither
  of which Arabic has, so it reaches for weight instead;
- numerals stay **Latin digits**. Prices, totals and order references are read
  against card statements, invoices and bank apps that use them, and Eastern
  Arabic numerals would force the shopper to translate between the two.

### 2.3 Shape and elevation

Radii echo the pebble: `xs 8px → sm 12 → md 18 → lg 28 → xl 36 → 2xl 48 → pill`.
Cards are `lg`, panels `xl`, hero plates `2xl`.

Shadows are wide, low-opacity and warm-tinted — never a hard grey drop.

```
lift   0 1px 2px  /0.04, 0 8px 24px  -12px /0.12   resting cards
float  0 2px 6px  /0.04, 0 18px 48px -20px /0.18   floating panels, nav
hover  0 4px 10px /0.05, 0 32px 64px -28px /0.26   lifted
violet 0 12px 40px -12px rgb(112 59 236 /0.45)     the violet CTA only
```

Glass (`.jo-glass`) is a 72% paper ground with `blur(20px) saturate(1.6)` — the
saturation bump is what stops frosted panels looking grey.

---

## 3. UX architecture

### 3.1 Sitemap

Every route is locale-scoped. `{locale}` is `en` or `ar`.

```
/{locale}                        Home
/{locale}/shop                   Listing — filters live in the URL
  ?category= &color= &size= &minPrice= &maxPrice= &sort= &onSale= &inStock=
/{locale}/product/[slug]         Product detail
/{locale}/categories             Category index
/{locale}/fitting-room           AI fitting room   ?product= pre-seeds a slot
/{locale}/cart                   Full bag
/{locale}/checkout               Three-step checkout    (no site chrome)
/{locale}/login  /register       Auth                   (no site chrome)
/{locale}/account                Profile, addresses, recent orders
/{locale}/wishlist               Saved pieces
/{locale}/orders                 Order history
/{locale}/orders/[reference]     Tracking timeline
/{locale}/admin                  Operations dashboard (read-only concept)

/api/checkout                    POST — re-prices, validates, writes the order
/api/search                      GET  — product search
/api/newsletter                  POST — subscribe
```

### 3.2 Bilingual routing

Routing is **prefix-always**: `/en/shop` and `/ar/shop`, never a bare `/shop`.
Leaving the default locale unprefixed saves six characters and costs a
duplicate-content problem, an ambiguous root, and a special case in every link
helper. One shape for both languages is worth more than a shorter English URL.

`src/middleware.ts` redirects an unprefixed path (307, not 308 — the choice is
request-dependent and must not be cached as permanent) using, in order:

1. the `NEXT_LOCALE` cookie — a returning shopper's explicit choice, which has
   to outrank their browser configuration;
2. `Accept-Language`;
3. English.

Three pieces keep the locale from leaking away mid-journey:

- **`src/components/ui/Link.tsx`** — a drop-in `next/link` replacement that
  prefixes internal hrefs from the active locale. Components keep writing
  `href="/shop"`. One forgotten prefix would drop an Arabic shopper into English,
  and that is exactly the kind of bug that survives review, so it is removed at
  the component level rather than left to discipline. `useLocalizedRouter()` does
  the same for imperative navigation.
- **`src/lib/i18n/dictionaries.ts`** — interface copy, keyed identically in both
  languages. `en` defines the shape; `ar` is typed against it, so a missing key
  fails the build.
- **`LocaleProvider`** — gives Client Components the locale, direction and
  dictionary without every component in between forwarding a prop it does not
  use.

Server Components take `locale` from `params` and call `getDictionary(locale)`;
Client Components read `useI18n()`. That split is not arbitrary — Server
Components cannot use React context, so an explicit lookup is the only option
there.

The language switcher keeps the current path **and its query string**: someone
who has filtered the shop to black coats in size M and switches language expects
the same list in Arabic, not the homepage. Each language is labelled in itself
("العربية", not "Arabic") — someone who cannot read the current language still
has to be able to find their own.

`hreflang` tags for `en-JO`, `ar-JO` and `x-default` ship on every page. Without
them Google treats the two trees as competing duplicates rather than translations
and picks one to index.

### 3.3 Route groups

Two shells, and the split is a UX decision, not a technical one:

- **`(store)`** — `src/app/[locale]/(store)/layout.tsx`. Announcement bar,
  floating nav, footer, mini cart, search overlay. Everything a customer browses.
- **`(focused)`** — `src/app/[locale]/(focused)/layout.tsx`. **No navigation, no
  footer, no cart drawer.** Checkout and auth live here. Once someone has decided
  to buy or sign in, every other link on the page is an exit.

`app/layout.tsx` is a deliberate passthrough — `<html>` needs `lang` and `dir`,
and both depend on a locale that only exists once `[locale]` has matched, so the
real document shell lives in `app/[locale]/layout.tsx`.

### 3.4 RTL

RTL is a `dir` attribute, not a second stylesheet. The entire codebase uses
logical properties — `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-` — so the
layout mirrors itself. An audit for physical direction classes returns two hits,
both in the cursor, where `left-0` is correct because the position comes from
viewport coordinates rather than from layout flow.

The one place that needed real thought was the filter toggle: it animates
`insetInlineStart`, not `left`, because in RTL the knob has to travel from the
right edge and a physical `left` would slide it backwards.

### 3.3 Key flows

**Browse → buy (the short path)**

```
Home → hover a card → quick-add size rail → cart drawer opens → Checkout
```

Three clicks from homepage to checkout. The quick-add rail on `ProductCard`
exists precisely so a decided customer never has to open the PDP.

**Browse → consider → buy**

```
Home → Shop → filter (URL updates, back button works) → PDP
     → colour + size → fit note → Add to bag → drawer → Checkout
```

**Fitting room**

```
/fitting-room → pick a slot → choose a piece → stage updates
              → set measurements once → every piece gets its own size
              → Add the look → cart drawer
```

**Checkout** — three steps on one route, not three routes: the customer can see
how far they have to go, and the back button never drops them out of the flow.

```
1 Delivery   email, name, phone, address      (validated on Continue)
2 Shipping   method — total updates live
3 Payment    method → gateway element
           ↓
POST /api/checkout  — server re-prices everything
           ↓
Confirmation with reference → /orders/[reference]
```

### 3.4 Empty, loading and error states

Every one is designed, because they are a third of the real experience:

| State | Treatment |
| --- | --- |
| Loading a grid | Skeleton in the exact final layout (`ProductGridSkeleton`) — never a spinner |
| Empty cart | Animated brand ripple + two routes out (shop / fitting room) |
| Empty wishlist | Explains *how* to save something |
| No search results | Names the term, suggests what to try |
| No orders | Explains what will appear here |
| Order not found | Suggests the likely cause (wrong account) |
| Route error | Calm copy, `error.digest` for support, working retry |
| 404 | Editorial, on-brand, two ways back |

---

## 4. Motion system

Defined once in `src/lib/motion.ts` and consumed everywhere. Three rules:

1. **One house curve.** `EASE.jo = cubic-bezier(0.22, 1, 0.36, 1)` for anything
   moving in space. `EASE.silk` for opacity and colour. `EASE.spring` only where
   overshoot is deliberate — the cart badge, add-to-bag, the logo's dot.
2. **Distance scales with surface size.** A chip travels 6px, a card 16px, a
   section 28px. Nothing slides further than it is tall.
3. **Nothing exceeds 700ms** except ambient loops.

```
instant 120ms   quick 220ms   base 380ms   slow 600ms   ambient 9s
```

### 4.1 The logo animation — `components/brand/AnimatedLogo.tsx`

**Intro** (1.6s, once per session): the bubble inflates from `scale 0.2` with a
`-14°` rotation, the monogram fades up at +0.22s, and the dot **drops in last**
at +0.46s from up-left with a spring overshoot. Nothing else moves while the dot
lands — that beat is what reads as "brand".

**Hover**: the bubble morphs continuously through its wave states, scales to
1.06, rotates 3°; the dot pops to 1.35; a violet ripple escapes the silhouette
on a 1.6s loop. All of it stops when the pointer leaves.

Two implementation details that matter:

- The wave morph works because every path in `BLOB_WAVES` shares an **identical
  command sequence**, so Motion's string interpolation can walk the numbers
  pairwise. Re-tracing the artwork must preserve that.
- Morph and transform live on **different elements**. An element with an object
  `animate` prop stops receiving variant labels from its parent, so the
  transform sits on a wrapping `<g>` and the `d` morph on the path inside.
- Every animated `d` carries a literal `d` attribute too. Without it Motion
  interpolates from `undefined` and writes the string `"undefined"` into the
  attribute — the path silently disappears.

### 4.2 The Lottie — `public/lottie/jo-bubble-wave.json`

A real bodymovin v5 file, **generated from the logo geometry** by
`scripts/generate-brand.mjs` (`npm run brand`). The traced SVG cubics are
converted to Lottie bezier data — vertices plus tangents made relative to their
vertex, which is the whole conversion — then keyframed:

- **8 layers**, 512×512, 60fps, 4s loop
- the bubble morphs through all four wave states and back
- the monogram counter-breathes at 104%
- the dot pulses to 126% and dims to 74%
- three ripple rings expand outward from 100% to ~214–298%, fading to zero,
  staggered so the field reads as one continuous expansion

`JoLottie` loads it **lazily**: an `IntersectionObserver` triggers the import of
both the player (~60KB) and the JSON only when the element is about to be seen,
and `JoWave` — an inline-SVG version of the same motion, ~1KB of DOM — renders
until then and **permanently replaces it** under `prefers-reduced-motion`.
Nothing is downloaded that will not play.

### 4.3 The cursor — `components/cursor/JoCursor.tsx`

The mark is a bubble with a detached dot, which maps onto a cursor almost too
neatly. The design takes it literally:

- **The dot is the real pointer.** 6px, violet, spring `{1400, 60, 0.25}` — zero
  perceptible lag. Precision is never traded for style.
- **The bubble trails behind** on a softer spring `{420, 34, 0.55}`, morphing
  through its wave states on a 7s loop. It is the personality, and it is never
  the thing you aim with.

States are declarative — any element opts in with a data attribute:

```html
<button data-cursor="hover">                        bubble → 58px
<a data-cursor="view" data-cursor-label="View">      bubble → 84px violet, label inside, dot hidden
<input data-cursor="text">                           bubble → 2×26px caret bar
```

Sensible defaults mean most of the site needs no annotation: `a`, `button`,
`[role=button]` get `hover`; inputs get `text`.

On click, the **logo silhouette** expands from the exact click point and fades.

Bail-outs, all deliberate: no pointer-fine device → never mounts;
`prefers-reduced-motion` → never mounts; window blur or pointer leaving the
document → fades out. The OS cursor is only hidden **after** the component
mounts and sets `data-jo-cursor="on"` on `<html>`, so a JS failure can never
leave a visitor with no pointer at all.

### 4.4 Microinteractions

| Surface | Behaviour |
| --- | --- |
| Product card | Image scales 1.05 in a fixed frame; second angle crossfades; quick-add rail slides up; wishlist heart fades in |
| Cart badge | Re-keyed on every add → replays a `[0, 1.35, 1]` spring pop |
| Quantity | Number crossfades on change; line collapses its own height on remove |
| Free-shipping meter | Bar animates to the new ratio over 700ms |
| Buttons | 2% compression + ink ripple from the exact click point |
| Section reveals | `whileInView` once, fires ~12% before entry so it is settling as the eye arrives |
| Headlines | Line-by-line mask reveal, 100ms apart |
| Filters | `useTransition` — results dim to 60% rather than collapsing to a spinner |
| Fitting room | Garment tiles `layout`-animate as slots fill |

### 4.5 The checkout CTA

Four states, and the third and fourth are the ones usually skipped:

```
rest      violet fill, shadow-violet, magnetic drift (capped at 6px)
press     scale 0.97 + ink ripple from the click point
loading   spinner + "Working", width unchanged so nothing jumps
success   stroke-drawn tick over 360ms, held 900ms before advancing
```

That 900ms hold is the point. A CTA that jumps straight from click to new page
feels broken even when it is not — the success beat is what makes a transaction
feel *completed* rather than merely submitted.

### 4.6 Reduced motion

One global honour in `globals.css` collapses every duration to 0.01ms, and
individual components check `useReducedMotion()` to skip animation entirely
rather than run it instantly. Content always reaches its final state; the
cursor never mounts; the Lottie never downloads; the marquee becomes a static
scrollable row.

---

## 5. Layout system

- **Container** — `.jo-container`, max `88rem`, gutters `1.25rem` → `2.5rem` at
  `md`.
- **Section rhythm** — `py-16 md:py-24`, `md:py-28` for editorial sections. One
  value, used everywhere, so adding or removing a section never disturbs the
  page's vertical music.
- **Grids** — products `2 / 3 / 4` columns; categories a deliberate mosaic with
  a double-height first tile; the promo rail asymmetric (`span: 2` + two
  standard) because equal thirds read as an ad block.
- **Logical properties throughout** — `ps-`, `pe-`, `ms-`, `me-`, `start-`,
  `end-`. RTL is a `dir` attribute, not a second stylesheet.

---

## 6. Homepage, section by section

| # | Section | Purpose | Component |
| --- | --- | --- | --- |
| 1 | Announcement | Shipping + returns promise | `AnnouncementBar` → `Marquee` |
| 2 | Hero | Positioning + 3 live product cards | `home/Hero.tsx` |
| 3 | Campaigns | The advertising surface | `home/PromoRail.tsx` |
| 4 | New arrivals | Freshness | `ProductRail` |
| 5 | Categories | Structural navigation | `home/CategoryGrid.tsx` |
| 6 | Featured | Editorial pick | `ProductGrid` |
| 7 | AI fitting room | The differentiator — a working slice | `home/FittingRoomTeaser.tsx` |
| 8 | Offers | Reductions | `ProductGrid` |
| 9 | Trending | Social proof by volume | `ProductRail` |
| 10 | Brand story | Why it costs what it costs | `home/BrandStory.tsx` |
| 11 | Reviews | Verified proof | `home/Testimonials.tsx` |
| 12 | Newsletter | Capture | `home/Newsletter.tsx` |
| 13 | Closing | One line, two CTAs | inline |
| 14 | Footer | Navigation + trust | `layout/Footer.tsx` |

**Shop early, story late.** A first-time visitor needs product before
philosophy; sections 2–9 are all shoppable before the brand story appears.

### The campaign rail (the ads area)

One card shape drives every campaign type — product launch, flash offer,
seasonal story, feature announcement. Marketing controls `slot`, `tone`, `span`
and `priority` from Firestore, so a campaign moves between placements without a
deploy and without a designer.

What keeps it from looking like an ad block:

- a deliberately asymmetric grid, not equal thirds;
- four tones (`ink` / `violet` / `sand` / `paper`) with matched typography,
  rather than one generic card chrome;
- a **live countdown** on anything with an `endsAt` — the one piece of urgency
  that is factual rather than manufactured. It renders nothing until mounted,
  because a timestamp formatted during SSR is wrong by the time it reaches the
  browser;
- the media plate parallaxes inside its frame on hover, so the card reads as a
  window rather than a picture;
- campaigns self-expire — a card past its `endsAt` never survives a stale cache
  into the page.

---

## 7. The AI fitting room

Two jobs, deliberately on one screen.

**1. Compose a look.** Five slots — outerwear, top, bottom, shoes, accessory.
The stage stacks the chosen pieces so a combination can be judged as an outfit,
which a grid of product cards can never show.

**2. Answer "will it fit".** This is the part that is actually implemented, in
`src/lib/fitting.ts` — a transparent, auditable model rather than a black box:

1. Each size carries garment measurements (chest / waist / hip, cm).
2. Body measurement + target **ease** gives the ideal garment measurement for
   how that customer likes clothes to sit (slim 4cm, regular 8cm, relaxed 14cm,
   plus the garment's own silhouette ease).
3. Every size is scored by weighted distance from that ideal — chest dominates
   for tops, waist for trousers.
4. **Too tight is penalised 1.6× harder than too loose.** A garment that does
   not close is unwearable; one that is roomy is merely not perfect.
5. **Stretch forgives tightness only** (none 0cm → high 7cm). It can never make
   a too-large garment correct.
6. **Confidence is the gap between the best and second-best score.** Below 0.6
   the UI says *"between sizes"* and names both, instead of inventing certainty.

That last rule is the design decision that matters. A wrong confident answer
costs a return and the trust to come back; a hedged one costs nothing.

Swapping this for an ML model means replacing the body of `recommendSize` — the
return shape (`FitRecommendation`) is the contract the UI depends on.

---

## 8. Technical architecture

```
Next.js 15 · App Router · React 19 · TypeScript (strict) · Tailwind CSS v4
Motion 12 · Lottie React · Zustand 5 · Firebase 12 · Firebase Admin 14
```

### Rendering strategy

| Route | Strategy | Why |
| --- | --- | --- |
| `/` | Static, `revalidate 3600` | Catalogue changes a few times a day |
| `/shop` | Server-rendered per search param | Filtered URLs must be shareable and indexable |
| `/product/[slug]` | `generateStaticParams` + ISR | Small, stable catalogue — pre-render all of it |
| `/cart`, `/checkout` | Client | Reads `localStorage` |
| `/account`, `/orders` | Client-fetched | Reads carry the customer's own auth token |
| `/api/*` | Node runtime, dynamic | Admin SDK needs Node |

### Server / client split

Server Components fetch and pass down; Client Components only wrap what needs
interactivity. `Hero`, `PromoRail` and `FittingRoom` are clients that receive
their data as props rather than re-fetching it.

### The catalogue repository — `src/lib/catalog.ts`

One place the UI asks for products, categories, banners and offers. It reads
Firestore and **falls back to the bundled demo catalogue** on an empty result,
an error, *or a 4-second timeout*. Three consequences:

1. the storefront renders on a clean clone, before a single document exists;
2. an unreachable Firestore can never take the shop offline;
3. the seed script pushes exactly the same shape, so live and fallback data
   cannot drift.

Every function is wrapped in React's `cache()`, so a page asking for the same
query in three places issues one read per request.

Filtering happens in memory. That is correct for a twelve-piece collection and a
PLP that wants multi-select facets Firestore cannot express in one composite
index. Past a few thousand SKUs it should move to Algolia or Typesense — the
note is in the code, at the function that would need to change.

### State

| Store | Scope | Persistence |
| --- | --- | --- |
| `store/cart.ts` | Cart lines, currency | `localStorage`, merges with the server cart on sign-in |
| `store/wishlist.ts` | Product **ids only** | `localStorage`, unions with the server list |
| `store/ui.ts` | Drawers, cursor mode, intro | None (intro flag in `sessionStorage`) |

The wishlist stores ids only, so a list saved six months ago shows today's
price rather than a stale snapshot. Cart merge takes the **larger** quantity
rather than summing — someone who added 2 on their phone and 2 on desktop meant
2, not 4.

---

## 9. Folder structure

```
the-jo-shop/
├── public/
│   ├── brand/          jo-mark.svg, -light, -violet, jo-icon.svg, PNG lockups
│   ├── demo/           35 generated product + campaign placeholders
│   ├── fonts/          Quadrillion Sb / Sb-Italic (otf + woff2)
│   └── lottie/         jo-bubble-wave.json
├── scripts/
│   ├── brand-paths.json      traced logo geometry (the source of truth)
│   ├── generate-brand.mjs    → SVGs, paths.ts, the Lottie
│   └── seed.ts               → Firestore
├── src/
│   ├── app/
│   │   ├── layout.tsx              fonts, metadata, providers, cursor, intro
│   │   ├── globals.css             the entire design system
│   │   ├── error.tsx  not-found.tsx
│   │   ├── (store)/                full chrome
│   │   │   ├── layout.tsx  loading.tsx  page.tsx
│   │   │   ├── shop/  product/[slug]/  categories/
│   │   │   ├── fitting-room/  cart/  wishlist/
│   │   │   ├── account/  orders/[reference]/  admin/
│   │   ├── (focused)/              no chrome
│   │   │   ├── layout.tsx  checkout/  login/  register/
│   │   └── api/                    checkout/  search/  newsletter/
│   ├── components/
│   │   ├── brand/      paths.ts, JoMark, JoLockup, AnimatedLogo, JoWave,
│   │   │               JoLottie, BrandIntro
│   │   ├── cursor/     JoCursor
│   │   ├── layout/     Navbar, Footer, AnnouncementBar, SearchOverlay
│   │   ├── home/       Hero, PromoRail, CategoryGrid, BrandStory,
│   │   │               FittingRoomTeaser, Testimonials, Newsletter
│   │   ├── product/    ProductCard, ProductGrid, ProductRail, ProductDetail
│   │   ├── shop/       FilterBar
│   │   ├── cart/       CartDrawer, CartPageClient
│   │   ├── checkout/   CheckoutFlow
│   │   ├── fitting/    FittingRoom
│   │   ├── account/    AccountPanel, OrdersList, OrderTracking,
│   │   │               WishlistClient, RequireAuth
│   │   ├── auth/       AuthForm
│   │   ├── providers/  AuthProvider
│   │   └── ui/         Button, Price, Badge, Reveal, Marquee,
│   │                   SectionHeading, PageIntro
│   ├── lib/
│   │   ├── firebase/   config, client, admin, converters, auth, orders
│   │   ├── store/      cart, wishlist, ui
│   │   ├── catalog.ts  pricing.ts  fitting.ts  motion.ts  format.ts  utils.ts
│   ├── data/demo.ts
│   └── types/index.ts
├── firestore.rules  storage.rules  firestore.indexes.json  firebase.json
└── .env.example
```

---

## 10. Firebase structure

```
products/{productId}
  slug, title{en,ar}, subtitle, description, details[]
  categoryId, categoryPath[], collectionIds[], tags[]
  price, compareAtPrice, currency
  images[]  { url, alt, width, height, blurDataURL, colorId }
  colors[]  { id, name{}, hex, hexSecondary }
  sizes[]   { id, label, system, measurements{chest,waist,hip,length,sleeve} }
  inStock, totalStock          ← aggregated by a Function, never client-written
  badges[], rating{average,count}
  fit { scale -2..2, silhouette, stretch, modelHeightCm, modelWearsSizeId }
  status draft|active|archived, publishedAt, updatedAt

  variants/{sku}               ← per-permutation stock, the authoritative count
    colorId, sizeId, stock, priceOverride, barcode

categories/{categoryId}        slug, name{}, parentId, order, productCount, featured
collections/{collectionId}     slug, name{}, productIds[], season, active

banners/{bannerId}             ← the whole merchandising system, one shape
  slot hero|promo-rail|spotlight|category-strip|announcement
  tone ink|violet|sand|paper
  eyebrow{}, title{}, body{}, cta{label{},href}, media{}
  startsAt, endsAt, priority, span 1|2, active

offers/{offerId}
  code, type percentage|fixed|free-shipping|bundle, value
  minSubtotal, appliesToCategoryIds[], appliesToProductIds[]
  startsAt, endsAt, usageLimit, usageCount, perUserLimit, active

users/{uid}                    ← document id IS the auth uid
  email, displayName, photoURL, phone, locale, currency
  addresses[], wishlist[], marketingOptIn
  fitProfile { heightCm, weightKg, chestCm, waistCm, hipCm, preferredFit }
  role                         ← mirror only; the claim is authoritative
  users/{uid}/outfits/{id}     ← saved fitting-room looks, private

carts/{uid}                    items[], updatedAt

orders/{orderId}
  reference JO-XXXXXX, uid, email
  items[] (price snapshot), totals{subtotal,discount,shipping,tax,total,currency}
  shippingAddress, shippingMethod, appliedOfferCode
  paymentMethod, paymentIntentId          ← never card data
  status, timeline[], trackingNumber, trackingUrl, estimatedDeliveryAt

subscribers/{email}            ← document id is the email: idempotent writes
auditLog/{entryId}             ← Function-written, admin-readable
```

### Storage

```
products/{productId}/{file}    public read, staff write
banners/{file}                 public read, staff write
users/{uid}/avatar/{file}      owner only
users/{uid}/fitting/{file}     owner only — never staff-readable
```

### Composite indexes

In `firestore.indexes.json`: `products(status, publishedAt desc)`,
`products(status, categoryId, publishedAt desc)`,
`banners(slot, active, priority desc)`, `orders(uid, createdAt desc)`,
`orders(uid, reference)`.

---

## 11. Security

The whole model in one line: **the client may read the catalogue and its own
data, and may write nothing that involves money.**

### Rules

`firestore.rules` and `storage.rules` are fully commented. The load-bearing
decisions:

- **`role` is read from the token, never from a document.** Reading it from
  Firestore would let anyone who can write that document escalate themselves.
- **`allow create: if false` on `orders`.** No client may create an order. The
  Admin SDK bypasses rules entirely, and that asymmetry *is* the mechanism: it
  is the only way to guarantee the price charged is the price we set.
- **User updates are a field whitelist**, not a blacklist. A sensitive field
  added next year is denied by default rather than accidentally writable.
- **Default deny** (`match /{document=**}`) closes the file.
- **No SVG uploads, anywhere.** An SVG is an executable document; served from
  your own origin that is stored XSS. This is also what makes
  `dangerouslyAllowSVG` in `next.config.ts` safe — customer files can never
  reach that path.

### `/api/checkout`

Everything the browser sends is a *request*, never a fact:

| Client claims | Server does |
| --- | --- |
| Line prices | Ignores them; reads from the catalogue |
| A discount code | Re-validates window, limits, minimum spend |
| A shipping method | Looks it up by id |
| Quantities | Clamps to available stock |
| The total | Never even reads it |

Stock is decremented inside a Firestore **transaction**, so two people buying
the last piece cannot both succeed — the loser gets a 409 naming the piece.

### Secrets

`NEXT_PUBLIC_FIREBASE_*` are public identifiers, not credentials — they ship in
the bundle by design. They live in env so one codebase can target dev, staging
and prod. What actually protects data is Security Rules, App Check, and
server-only order logic.

The real secrets — `FIREBASE_ADMIN_PRIVATE_KEY`, `STRIPE_SECRET_KEY` — are
never `NEXT_PUBLIC_`, and `src/lib/firebase/admin.ts` opens with
`import "server-only"` so the build **fails** if a Client Component ever imports
it, rather than quietly leaking a service account into the browser bundle.

### Payments

Card fields are deliberately **not** in this codebase. The card step hands off
to a PSD2-compliant gateway element (Stripe / Checkout.com) rendered in the
provider's own iframe. Taking a raw PAN into React state is what turns a small
store into a PCI-DSS audit.

---

## 12. Performance

| Decision | Effect |
| --- | --- |
| Server Components by default | Product markup ships as HTML, not as a fetch waterfall |
| `next/font`, self-hosted, woff2 | No render-blocking font request, no layout shift |
| Lottie behind an `IntersectionObserver` | ~60KB player + 21KB JSON never load above the fold, and never at all under reduced motion |
| `JoWave` as the default ambient | ~1KB of DOM instead of a player, for most decorative moments |
| AVIF/WebP via `next/image` | Automatic, with `sizes` set per grid breakpoint |
| `priority` on the first row only | One LCP candidate, not twelve |
| Native scroll + snap for rails | No carousel library; keyboard, trackpad and reading order for free |
| Filters in the URL + `useTransition` | Server-rendered results, no client-side filter state to desync |
| `persistentLocalCache` on Firestore | Returning shoppers see the catalogue instantly; the cart survives a dropped connection |
| React `cache()` on every query | One read per request regardless of how many components ask |
| 4s read timeout → demo fallback | A slow backend degrades to cached content instead of a hanging page |

### Accessibility

Skip link first in the DOM · visible `:focus-visible` ring on the brand violet ·
`aria-pressed` on every toggle, swatch and size · `role="listbox"` with
`aria-activedescendant` in search · `aria-live` on the result count · alt text
required by the `ProductImage` type, not optional · full keyboard paths through
search, filters, cart and checkout · `maximumScale: 5` (never block zoom) ·
reduced motion honoured globally *and* per component.

---

## 13. Running it

```bash
npm install
cp .env.example .env.local     # Firebase web config already filled in .env.local
npm run dev                    # http://localhost:3000
```

The storefront renders immediately against the bundled demo catalogue. To go
live on Firestore:

```bash
# 1. Create the Firestore database (Native mode) in the Firebase console
# 2. Service account → Generate new private key → FIREBASE_ADMIN_* in .env.local
npm run seed                   # push the demo catalogue
npm run rules:deploy           # firestore.rules + storage.rules
# 3. Set NEXT_PUBLIC_DISABLE_DEMO_FALLBACK=true so read failures surface
```

Other scripts: `npm run brand` regenerates every brand asset from
`scripts/brand-paths.json`; `npm run typecheck`; `npm run emulators`.
