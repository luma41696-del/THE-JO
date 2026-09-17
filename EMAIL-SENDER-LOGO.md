# The logo in the sender's circle

That grey silhouette beside "Net Sale" in Gmail is the **sender avatar**, and
nothing in the email controls it. Not the HTML, not the From name, not an image
in the template. It is decided entirely outside the message, by a standard
called **BIMI** — Brand Indicators for Message Identification.

So this is not a code change. The code side is finished; what is left is DNS
and, for Gmail specifically, a paid certificate. This file is what is left.

---

## What is already done

| | |
|---|---|
| **A BIMI-profile logo** | `public/brand/bimi-logo.svg`, served at `https://netsale.shop/brand/bimi-logo.svg` |
| **DMARC at enforcement** | `p=quarantine` on `netsale.shop` — this is a prerequisite and it is already met |
| **An aligned sending domain** | `send.netsale.shop`, relaxed alignment against the apex |

The logo is not an ordinary SVG. BIMI takes **SVG Portable/Secure**, a small
subset of SVG Tiny 1.2, and rejects anything outside it — no `<script>`, no
`<image>`, no external references, a required `<title>`, a square `viewBox`
starting at `0 0`, under 32 KB. A perfectly good export from a design tool is
usually rejected, which is why `scripts/bimi-logo.test.ts` asserts each rule.
**Re-export the logo and run `npm run test:bimi-logo` before publishing it.**

The rejection, if it happens, comes from the mail provider weeks after the DNS
record went in, and is reported to nobody. That is the whole reason for the test.

Look at it at the sizes clients draw it: `/demo/bimi-preview.html`.

---

## What is left, and what it costs

### Step 1 — publish the DNS record (free)

```
default._bimi.netsale.shop   TXT   v=BIMI1; l=https://netsale.shop/brand/bimi-logo.svg;
```

That is the whole record. The logo must be served over HTTPS, publicly, with no
redirect and no authentication.

This alone is enough for the providers that accept a **self-asserted** BIMI
record — Fastmail, La Poste, Zone, and historically Yahoo and AOL. Those
inboxes will start showing the logo.

**Gmail will not.** Which brings us to the part that costs money.

### Step 2 — the certificate, for Gmail (paid)

Gmail only shows a BIMI logo when the record also points at a certificate
proving the logo is yours. There are two kinds:

| | **VMC** | **CMC** |
|---|---|---|
| Full name | Verified Mark Certificate | Common Mark Certificate |
| Requires | a **registered trademark** for the logo | the logo in **public use for 12+ months** |
| Issued by | DigiCert, Entrust | DigiCert, Entrust |
| Rough cost | **~1,000–1,500 USD per year** | cheaper, but still an annual fee |

A CMC is the realistic route for a shop without a registered trademark. Both are
annual and both renew.

With one, the record gains an `a=` pointer:

```
default._bimi.netsale.shop   TXT   v=BIMI1; l=https://netsale.shop/brand/bimi-logo.svg; a=https://netsale.shop/brand/netsale.pem;
```

**I have not started, quoted, or signed up for any of this.** It is an ongoing
external cost and the decision is yours. Prices and Gmail's policy both change —
check DigiCert or Entrust directly, and Google's current BIMI page, before
committing.

---

## The honest summary

- **Free, today:** publish the TXT record. Some inboxes show the logo. Gmail does not.
- **Paid, annually:** a CMC or VMC. Gmail shows the logo.
- **Not possible:** making Gmail show it any other way. There is no trick, no
  header, and no image in the message that does it. Gravatar does not work in
  Gmail either.

One thing that is *not* a shortcut but is worth knowing: if the shop ever sends
from a Google Workspace mailbox on its own domain, Gmail uses that account's
profile photo for recipients. That is not how this shop sends — it sends through
Resend from `no-reply@send.netsale.shop`, which is not a Workspace account — so
it does not apply here, and switching to it would mean giving up the provider.

---

## If the logo is ever redrawn

1. Replace `public/brand/bimi-logo.svg`, keeping it square, opaque to the edges,
   and with the mark inside the inscribed circle (clients crop to a circle).
2. `npm run test:bimi-logo`
3. Look at `/demo/bimi-preview.html` at 32px. If it stops reading there, simplify.
4. Re-issue the certificate if one has been bought — it is bound to the logo
   file, and changing the artwork invalidates it.
