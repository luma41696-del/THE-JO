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

### Tier 2 — A photorealistic try-on image  ⛔ **blocked: needs a provider**

Generating a photo of *this customer* wearing *this garment* — the thing the
Google VTO demo you linked does. This is a diffusion model, not geometry.

Requirements that do not exist in this project today:

| Requirement | Detail |
|---|---|
| Google Cloud project with Vertex AI enabled | billing account attached |
| Model access | `virtual-try-on` on Vertex AI, region-restricted |
| Service-account key | server-side only, never in the browser |
| Per-image cost | roughly **USD 0.04–0.10** per generated image at list price |
| Latency | 5–20 seconds; needs a job queue, not a request |
| Garment input | a clean, front-facing, flat-lay or on-model shot per product |

The integration surface is written and wired (`src/lib/fitting/provider.ts`) —
it reads `VTO_PROVIDER`, `VTO_API_KEY` and `VTO_PROJECT_ID` from the
environment, queues a job, and reports `queued → running → done/failed` with
retry. With no keys configured it returns `not-configured` and the UI says so
plainly. **It never shows a fake result.**

To enable: set those three variables and implement `callVertexVto()` — the
request/response shape is documented in that file.

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
| Avatar parameters | the customer's own profile document |
| Retention | 90 days for photos, then eligible for deletion; deletable by the owner at any time from the fitting room |
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
| Photoreal try-on image | ⛔ provider + keys + budget (tier 2 above) |
| Fabric simulation | ⛔ authored glTF per garment (tier 3 above) |
