# Fitting room — what is built, what is blocked, what it costs

You asked me to assess the real capability before writing anything, and to
separate three things that get sold as one. They are genuinely different
problems with different costs, and conflating them is how a demo gets shipped
as a feature.

---

## The three tiers, honestly

### Tier 1 — A parametric 3D avatar from measurements  ✅ **built**

A real, rotatable, zoomable 3D body mesh, generated in the browser from the
customer's own measurements (height, chest, waist, hip).

Garments are cut from the **recommended size's own measurement table**, not
merely from the silhouette. At each measurement the table gives, the gap
between garment and body is computed and carried across the piece, so a size
larger than the body stands off it and a size smaller than the body renders
smaller than the body — the figure shows through, which is what a garment that
will not close looks like. Where a size has no table, the silhouette's ease is
used and nothing about the size is implied.

**What it is not:** it is not built from a photograph. Nothing about the
customer's face, skin or body shape is reconstructed from an image — the shape
comes from numbers they typed. The UI says this in both languages, on the
screen, not in a footnote.

- Cost: zero. Runs client-side, `three` is 0.6MB gzipped and lazy-loaded.
- Accuracy: good for proportion and drape-direction; it is a mannequin, not a
  likeness.

### Tier 2 — A photorealistic try-on image  ⚠️ **implemented, never yet run against Google**

Generating a photo of *this customer* wearing *this garment* — the thing the
Google VTO demo you linked does. This is a diffusion model, not geometry.

What it needs, and what the state of each is:

| Requirement | Detail |
|---|---|
| Google Cloud project with Vertex AI enabled | billing account attached |
| Model access | `virtual-try-on-001` (GA), region-restricted — the model id is **pinned**, not floating |
| Service account | `VTO_SERVICE_ACCOUNT_JSON`, server-side only, exchanged for a short-lived OAuth token on the `cloud-platform` scope. **Not an API key** — an API key cannot call `:predict` at all |
| Per-image cost | roughly **USD 0.04–0.10** per generated image at list price |
| Latency | 5–20 seconds; needs a job queue, not a request |
| Garment input | a clean, front-facing, flat-lay or on-model shot per product, JPEG or PNG, under 7MB |

`src/lib/fitting/provider.ts` now implements the call:

    POST https://{location}-aiplatform.googleapis.com/v1/projects/{projectId}
         /locations/{location}/publishers/google/models/virtual-try-on-001:predict

It reads the customer's photograph from `users/{uid}/fitting/` with the Admin
SDK, fetches the garment shot server-side, refuses anything that is not a JPEG
or PNG under 7MB *before* spending a request, sends both inline as base64, and
writes the returned image back into the same owner-only folder as
`try-on-{token}.{png|jpg}` — the flat folder, deliberately: the storage rules
match a single file name, so a result in a `results/` subfolder would be one
its own owner could not read, and `deleteFittingPhotos` would not remove it.

**Configuration** — three variables, none of them a key in a URL:

    VTO_PROVIDER=vertex-vto
    VTO_PROJECT_ID=the-jo-shop
    VTO_LOCATION=me-central1
    VTO_SERVICE_ACCOUNT_JSON={...}     # the whole service-account JSON

`VTO_API_KEY` is **gone**. A shop that still sets it reads as not configured.

**What is honest about its state:** the request shape, the validation, the
retry wording, the ownership check and the result path are covered by 31 tests
(`npm run test:vto`), and three of those guards were broken deliberately to
confirm the tests fail. But **no call has ever been made to Google from this
code** — there is no job runner and no UI path that invokes `callProvider()`
yet, so nothing in the storefront can trigger one. The first real call is what
proves the integration, and when it fails it will fail with Google's own
message on the job rather than silently.

### Tier 3 — Cloth and fit simulation  ⛔ **blocked: needs authored assets**

Simulating how *this fabric* falls on *this body* — drape, stretch, pull at the
shoulder. This is what CLO3D produces, and it cannot be derived from product
photography.

Each supported garment needs, authored by a 3D artist:

- a garment mesh (glTF 2.0 / GLB), sewn and simulated in CLO3D or Marvelous
- PBR materials: base colour, roughness, normal, and a fabric weight/stiffness
  profile
- real-world scale, and a size set — one mesh per size, or a parametric one
- skinning to the avatar's skeleton, so it deforms with the body
- a variant map, so colourways and embroidery swap without re-authoring

Realistic effort: **4–10 hours per garment** for an experienced artist, plus a
CLO3D licence (~USD 50/month standalone). For the current 14-piece catalogue
that is roughly 60–140 hours of authoring.

The loader for these assets is written (`GarmentModel` accepts a `glb` URL on
the product). Supply a GLB and it is used instead of the procedural garment;
supply none and the procedural one renders. Nothing has to change in the app.

---

## What is deliberately *not* claimed

- We do not promise an accurate size from a single photograph. The avatar is
  driven by typed measurements, and if they are missing the size panel says it
  needs them rather than guessing.
- The size recommendation is computed from the garment's own measurement table
  and is **separate from the render**. A confident-looking model wearing a
  garment is not evidence the size is right, and the two are never presented as
  one answer.
- When no size fits within tolerance, the panel says so. It does not round to
  the nearest and hope.

---

## Privacy

| | |
|---|---|
| Photos | `users/{uid}/fitting/` — owner-read only, **staff cannot read them** |
| Generated try-on images | the same folder, `try-on-*` — same owner-only rule, and removed by the same "delete my photos" action |
| Sent to Google | the photograph and the garment shot, inline in one request, under a service account that has no other access to the shop. Nothing identifying the customer travels with them — no uid, no name, no measurements |
| Avatar parameters | the customer's own profile document |
| Retention | 90 days for photos, 30 for generated images (`RESULT_RETENTION_DAYS`), then eligible for deletion; deletable by the owner at any time from the fitting room |
| External processing | never without the separate fitting-room consent, asked at the point of use — not bundled into the cookie banner |
| Analytics | measurements and image URLs are on the analytics deny-list and are dropped by both the client and the server |

---

## Completion criteria, against your list

| Step | State |
|---|---|
| Photo of a consenting user | ✅ upload, guidance, quality check, private storage |
| → rotatable avatar | ✅ **from measurements, not from the photo** — stated in the UI |
| → a prepared garment on it | ✅ procedural garments, cut to each silhouette's ease. No authored glTF is loaded, and no product carries one |
| → variant swap | ✅ colourway swaps on the same avatar, without rebuilding the body. Colour and size are the only variant axes the catalogue has — there is no separate "design" axis to swap |
| → save the outfit and add to cart | ✅ saved to the account, restorable, deletable; pieces resolve to a real variant before reaching the bag, and anything that cannot be added is named |
| Photoreal try-on image | ⚠️ the Vertex AI call is implemented and tested (tier 2 above); no job runner invokes it yet, and it has never run against Google |
| Fabric simulation | ⛔ authored glTF per garment (tier 3 above) |
