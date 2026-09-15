# Taking money

What the shop can charge today, what it cannot, and exactly what each missing
piece needs. Written in the same spirit as [FITTING-ROOM.md](FITTING-ROOM.md):
nothing here claims a capability that does not exist.

---

## Today

**Cash on delivery only.** It is the one method that works end to end, and it
is the only one the checkout offers.

`src/lib/payments.ts` is the single list. The checkout renders from it and
`/api/checkout` validates against it, so a method cannot be offered without
also being accepted, or accepted without being offered. Turning one on is a
flag in that file **plus** the integration behind it — the flag alone would
produce a checkout that fails at the last step, which is the most expensive
place in a shop to fail.

The list is not environment-dependent. A method that cannot take money in
production cannot take it in development either; showing card in dev only
teaches the team a flow works when it does not.

### What "cash on delivery" means for the rest of the system

- An order is created `pending`. Nothing has been paid.
- An operator moves it to `paid` when the courier settles. That transition is
  what issues the invoice and sends the payment-confirmed notice.
- So `paid` is a **statement about money received**, not about a card
  authorising. Keep it that way when a gateway arrives: a gateway callback
  should drive the same transition rather than inventing a parallel one.

---

## What a card gateway needs

Not a code problem first. In order:

### 1. A merchant account

The shop needs an acquiring relationship that settles to a Jordanian bank
account in JOD. This is a commercial arrangement with paperwork —
registration, trade licence, sometimes a security deposit — and typically
takes weeks, not hours.

**Check availability before writing any code.** Global processors do not all
operate in Jordan, and a provider that cannot settle to a JOD account is not a
candidate however good its API is. Ask each shortlisted provider directly:

- Do you support merchants registered in Jordan?
- Do you settle in JOD, to a local bank account?
- What are the per-transaction and monthly costs, and the settlement delay?
- Is 3-D Secure 2 included, and is it mandatory for local cards?
- Do you provide a hosted page or an iframe/SDK that keeps card fields off our
  domain? (See PCI scope below — this question decides the whole design.)

`.env.example` previously carried `STRIPE_*` variables. They have been removed
rather than left as a hint: they implied a chosen provider and a partially
built integration, and neither was true.

### 2. PCI-DSS scope — the decision that shapes everything

Card numbers must **never** be entered into this site's own input fields. If
they are, the shop enters full PCI-DSS scope: annual audits, quarterly scans,
and liability that no small shop wants.

Both acceptable designs keep the shop at the lowest scope (SAQ-A):

- **Hosted page.** The customer is redirected to the provider, pays, and comes
  back. Simplest, and the most robust; costs you the visual continuity of the
  checkout.
- **Iframe / provider SDK.** The card fields are rendered by the provider
  inside an iframe on our page. Keeps the design; requires care that nothing
  on the page can read into that frame.

The current checkout has a labelled mount point for the second option. It says
so on screen, in both languages, rather than rendering dead card inputs.

### 3. The integration, once a provider exists

Roughly, and in this order:

1. **Create a payment intent server-side** from the order the server already
   priced. Never from a total the browser sent — the existing
   `/api/checkout` re-prices from Firestore for exactly this reason, and that
   guarantee must survive.
2. **Return only a client secret / redirect URL** to the browser. The secret
   key stays in the server environment, as `FIREBASE_ADMIN_PRIVATE_KEY` does.
3. **Webhook, not the browser, confirms payment.** A customer closing the tab
   after paying must still get their order. The browser's "it worked" is a
   hint; the webhook is the fact.
4. **Verify the webhook signature** before trusting a byte of it, and make the
   handler idempotent — providers retry, and two "payment succeeded" events
   for one order must not mark it paid twice or send two confirmations.
5. **Drive the existing transition.** The webhook should move the order to
   `paid` through the same path the admin uses, so the invoice is issued and
   the customer notified by the code that already does both.
6. **Refunds call the provider**, then move the order to `refunded`, which
   already issues the credit note.

### 4. What must not be built

- Storing a card number, a CVV, or a full PAN anywhere. Not in Firestore, not
  in a log, not in an analytics event. The analytics allow-list already
  excludes payment fields; keep it that way.
- Trusting a client-supplied amount at any point.
- Marking an order paid from a browser callback alone.

---

## CliQ

Jordan's instant bank-transfer rail, and more widely used locally than any
card-on-file wallet — which is why it is in the payment catalogue rather than
an afterthought.

It is **not** a card gateway and does not work like one. Two shapes exist:

- **Manual.** Show the shop's CliQ alias, the customer transfers, someone
  reconciles the bank statement against order references. No integration at
  all, but it is real work every day and the reconciliation is where mistakes
  happen. If this is the route, the order should stay `pending` until a human
  confirms the transfer — never auto-paid on the customer saying they sent it.
- **Bank API.** Some acquiring banks expose a merchant API with a callback.
  This is a per-bank arrangement; there is no single national API to integrate
  against. Ask the shop's own bank what they offer.

Either way the same rule holds: `paid` means money arrived.

---

## Apple Pay / Google Pay

Wallets **over** a card gateway, not alternatives to one. They cannot be
enabled before a gateway exists, which is why the catalogue lists that as the
reason rather than leaving them looking merely unfinished.

---

## Completion criteria

| Step | State |
|---|---|
| Cash on delivery, end to end | ✅ order → invoice → notification |
| One list governing offered *and* accepted methods | ✅ `src/lib/payments.ts` |
| Card fields kept off our domain | ✅ by design — mount point only, stated on screen |
| Merchant account | ⛔ commercial, weeks, the shop's to obtain |
| Card gateway integration | ⛔ blocked on the above; steps 1–6 written out here |
| CliQ | ⛔ needs an alias, or the bank's own API |
| Apple / Google Pay | ⛔ needs a card gateway first |

Nothing in the shop pretends otherwise. The checkout offers what it can take.
