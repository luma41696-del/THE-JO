# THE JO | ذاجو

A premium fashion storefront — **bilingual (English / العربية)**, priced in
Jordanian dinar. Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Firebase,
Motion and Lottie.

The full design and architecture brief is in **[DESIGN.md](DESIGN.md)**: concept,
visual system, UX architecture, motion system, page breakdown, Firebase
structure and security model.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000> — you will be redirected to `/en` or `/ar`
depending on your browser language. The toggle in the navbar switches between
them and keeps your place, filters and all.

`.env.local` already contains the Firebase web config for `the-jo-shop`. The
storefront renders immediately against the **bundled demo catalogue** — twelve
products, six categories, five campaigns and generated artwork — so nothing is
blocked on a backend.

---

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run brand` | Regenerate every brand asset from `scripts/brand-paths.json` |
| `npm run seed` | Push the demo catalogue to Firestore (needs Admin SDK) |
| `npm run seed -- --wipe` | Clear those collections first |
| `npm run rules:deploy` | Deploy `firestore.rules` + `storage.rules` |
| `npm run emulators` | Firebase emulator suite |

---

## Connecting Firebase

The public web config is already in `.env.local`. Three things remain:

**1. Create the Firestore database.** Firebase console → Firestore Database →
Create database → **Native mode**. Until this exists, reads return
`5 NOT_FOUND` and the app serves the demo catalogue (this is expected, and the
storefront stays fully usable).

**2. Add a service account** for order writes and seeding. Project settings →
Service accounts → Generate new private key, then in `.env.local`:

```
FIREBASE_ADMIN_PROJECT_ID=the-jo-shop
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-…@the-jo-shop.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
```

Keep the literal `\n` escapes and the surrounding quotes.

**3. Seed and deploy rules:**

```bash
npm run seed
npm run rules:deploy
```

Then set `NEXT_PUBLIC_DISABLE_DEMO_FALLBACK=true` so a failed read surfaces
instead of silently falling back.

### Also worth enabling

- **Authentication** → Sign-in methods → Email/Password and Google.
- **App Check** → reCAPTCHA Enterprise → put the site key in
  `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`, then flip `appCheckOk()` in
  `firestore.rules` to `request.app != null`.

---

## Environment

| Variable | Secret? | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` | No | Public identifiers. They ship in the bundle by design — Security Rules and App Check are what protect data |
| `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` | No | reCAPTCHA Enterprise site key |
| `FIREBASE_ADMIN_*` | **Yes** | Service account. Never `NEXT_PUBLIC_` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **Yes** | Server only |
| `NEXT_PUBLIC_SITE_URL` | No | Canonical URLs, OG tags |

`src/lib/firebase/admin.ts` opens with `import "server-only"` — if a Client
Component ever imports it, the **build fails** rather than leaking the key.

---

## Languages & currency

Both languages are first-class. Routing is **prefix-always** — `/en/shop` and
`/ar/shop`, never a bare `/shop` — so neither language is a second-class
redirect and neither competes with the other for indexing.

| Piece | Where |
| --- | --- |
| Locales, direction, path helpers | `src/lib/i18n/config.ts` |
| Interface copy, both languages | `src/lib/i18n/dictionaries.ts` |
| Redirect + cookie + `Accept-Language` | `src/middleware.ts` |
| Locale for Client Components | `src/components/providers/LocaleProvider.tsx` |
| Locale-aware `Link` / `router.push` | `src/components/ui/Link.tsx` |
| The toggle | `src/components/layout/LanguageSwitcher.tsx` |

**Always import `Link` from `@/components/ui/Link`, never from `next/link`.**
The wrapper prefixes internal hrefs with the active locale; a plain `next/link`
would silently drop an Arabic shopper into English. Same for
`useLocalizedRouter()` in place of `useRouter()`.

Adding a string: put it in `en` in `dictionaries.ts`, then in `ar`. `en` defines
the type, so a missing or misspelled Arabic key fails the build.

RTL is handled by the `dir` attribute and logical properties (`ps-`, `pe-`,
`ms-`, `me-`, `start-`, `end-`) — there is no mirrored stylesheet. If you add a
physical `left`/`right`, you have introduced a bug in Arabic.

**Currency is JOD**, which has **three** decimal places (1000 fils).
`minorUnits()` in `src/lib/format.ts` is the single source of that, and
`money()` in `src/lib/pricing.ts` rounds to it — rounding a dinar to 2dp loses
a fils on every line and makes the order total disagree with the sum of its
lines. Sales tax is 16%.

---

## Project layout

```
public/brand              logo SVGs generated from the master artwork
public/demo               generated product + campaign placeholders
public/fonts              Quadrillion (logo face) + Baloo Bhaijaan 2 (5 weights)
public/lottie             jo-bubble-wave.json — generated from the logo geometry
scripts/                  brand asset generator, Firestore seeder
src/middleware.ts         locale negotiation and redirect
src/app/layout.tsx        passthrough — the real shell is under [locale]
src/app/[locale]/(store)  storefront routes — full chrome
src/app/[locale]/(focused) checkout + auth — deliberately no chrome
src/app/api               checkout, search, newsletter
src/components            brand, cursor, layout, home, product, cart, checkout,
                          fitting, account, auth, providers, ui
src/lib                   firebase, i18n, store (zustand), catalog, pricing,
                          fitting, motion, format
src/types                 the domain model
```

Full annotated tree in [DESIGN.md §9](DESIGN.md#9-folder-structure).

---

## The brand pipeline

Every piece of brand geometry comes from one file — `scripts/brand-paths.json`,
the logo traced to cubic beziers and normalised to a 120×120 box.

```bash
npm run brand
```

generates:

- `public/brand/jo-mark.svg`, `-light`, `-violet`, `jo-icon.svg`
- `src/components/brand/paths.ts` — typed constants for React/Motion
- `public/lottie/jo-bubble-wave.json` — a real bodymovin v5 file, 8 layers,
  built by converting the SVG cubics to Lottie bezier data

**Do not hand-edit the outputs.** The four `BLOB_WAVES` variants must keep an
identical command sequence to the base blob or Motion can no longer interpolate
between them, and the morph silently stops working.

---

## What is real vs. scaffolded

**Fully working:** catalogue with Firestore + demo fallback, filtering and
sorting via URL state, product detail with variants, cart and wishlist with
persistence and server merge, three-step checkout with server-side re-pricing
and a stock transaction, Firebase Auth (email + Google), order history and
tracking, search, the fitting room's size-recommendation engine, the whole
motion and cursor system, security rules.

**Scaffolded, by design:** the payment gateway element (the card step is a
labelled mount point — card fields are deliberately not in this codebase), the
try-on render pipeline (the data model and UI are complete; the stage shows
garment tiles rather than a generated composite), and `/admin`, which is
read-only with the five steps to production written on the page.

---

## Notes for this machine

The native SWC binary (`@next/swc-win32-x64-msvc`) is blocked here by a Windows
**Application Control policy**, so Next falls back to the WASM compiler. Two
consequences:

- `npm run dev` uses webpack, not Turbopack — first compile takes ~60–90s.
  Turbopack cannot run on the WASM fallback at all (`npm run dev:turbo` is kept
  for machines where the binary loads).
- Builds are slower than usual for the same reason.

If the policy is relaxed, both go back to normal with no code changes.

React is pinned to **19.1.9**. React 19.3 ships a view-transition commit path
that Next 15.5 does not yet handle, and it crashes hydration with
`Cannot read properties of undefined (reading 'i')`.
