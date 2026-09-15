import { creditNoteFrom, formatInvoiceNumber, invoiceFrom } from "@/lib/invoice";
import type { Invoice, Order } from "@/types";

/**
 * Allocating an invoice number.
 *
 * The whole reason this is not two lines in the orders route: the number has
 * to be **sequential and gapless**, and there are three ways to get that wrong
 * that all look fine until an audit.
 *
 *  1. Counting documents (`invoices.count() + 1`). Two orders paid in the same
 *     second read the same count and both claim -00042.
 *  2. Incrementing a counter, then writing the invoice. A failure between the
 *     two burns a number, and the sequence has a hole nobody can account for.
 *  3. Deriving it from a timestamp. Not sequential at all, just unique.
 *
 * So the counter read, the increment and the invoice write are one Firestore
 * transaction. Either the number is allocated and the document exists, or
 * neither happened and the next order takes that number.
 *
 * It is also **idempotent per order**. An operator double-clicking "mark paid",
 * or a retried request, must not produce two invoices for one order — so the
 * transaction looks for an existing one first, keyed on the order, and returns
 * it unchanged.
 *
 * No `server-only` guard, deliberately. The database is a *parameter* and the
 * Firestore type is erased at compile time, so nothing here actually pulls the
 * Admin SDK into a bundle — the marker would have been claiming a constraint
 * the file does not have, and it made the gapless behaviour untestable, which
 * is the one thing here most worth a test. The `.server` in the name still
 * says where it belongs.
 */

type Db = FirebaseFirestore.Firestore;

/** One counter document per year: `counters/invoices-2026`. */
const counterId = (year: number) => `invoices-${year}`;

export interface IssueResult {
  invoice: Invoice;
  /** False when this order already had one — the caller should not re-notify. */
  created: boolean;
}

/**
 * Issue the invoice for an order, or return the one it already has.
 *
 * `at` is passed in rather than read from the clock so a caller performing
 * several writes can stamp them all identically, and so tests are not timing
 * dependent.
 */
export async function issueInvoice(db: Db, order: Order, at = Date.now()): Promise<IssueResult> {
  const year = new Date(at).getUTCFullYear();
  const counterRef = db.collection("counters").doc(counterId(year));
  const invoices = db.collection("invoices");

  return db.runTransaction(async (tx) => {
    /*
     * Every read must happen before every write in a Firestore transaction,
     * so the existence check and the counter are both read up front.
     */
    const existingQuery = await tx.get(invoices.where("orderId", "==", order.id).limit(1));
    if (!existingQuery.empty) {
      const doc = existingQuery.docs[0]!;
      return { invoice: { ...(doc.data() as Invoice), id: doc.id }, created: false };
    }

    const counter = await tx.get(counterRef);
    const next = ((counter.data()?.next as number | undefined) ?? 0) + 1;

    const ref = invoices.doc();
    const invoice: Invoice = {
      ...invoiceFrom(order, formatInvoiceNumber(year, next), at),
      id: ref.id,
    };

    tx.set(counterRef, { next, year, updatedAt: at });
    tx.set(ref, invoice);

    return { invoice, created: true };
  });
}

/**
 * Issue a credit note against an order's invoice.
 *
 * Takes its own number from the same sequence: a credit note is a document in
 * the ledger, and skipping it would leave the year's numbering with a gap
 * exactly where the awkward transaction was.
 *
 * Returns null when the order never had an invoice — a refund on a cancelled
 * order has nothing to credit, and inventing a note for it would put a
 * negative against revenue that was never recognised.
 */
export async function issueCreditNote(
  db: Db,
  order: Order,
  at = Date.now(),
): Promise<Invoice | null> {
  const year = new Date(at).getUTCFullYear();
  const counterRef = db.collection("counters").doc(counterId(year));
  const invoices = db.collection("invoices");

  return db.runTransaction(async (tx) => {
    /*
     * The existing-note check comes **first**, and the order matters.
     *
     * Issuing a note marks the original `credited`, so a second refund finds
     * nothing under `status == "paid"`. Looking for the payable original first
     * therefore returned null on the second call — no second note, which was
     * right, but reported as "nothing to credit", which was not: the caller
     * then logged no credit-note number for a refund that has one.
     */
    const credited = await tx.get(
      invoices.where("orderId", "==", order.id).where("status", "==", "credited").limit(1),
    );

    // A pair: the original marked credited, and the note itself. The note is
    // the one carrying `notes`, so it is the one to hand back.
    const existingNote = credited.docs.find((d) => Boolean((d.data() as Invoice).notes));
    if (existingNote) {
      return { ...(existingNote.data() as Invoice), id: existingNote.id };
    }

    const originals = await tx.get(
      invoices.where("orderId", "==", order.id).where("status", "==", "paid").limit(1),
    );
    if (originals.empty) return null;

    const counter = await tx.get(counterRef);
    const next = ((counter.data()?.next as number | undefined) ?? 0) + 1;

    const originalDoc = originals.docs[0]!;
    const original = { ...(originalDoc.data() as Invoice), id: originalDoc.id };

    const ref = invoices.doc();
    const note: Invoice = {
      ...creditNoteFrom(original, formatInvoiceNumber(year, next), at),
      id: ref.id,
    };

    tx.set(counterRef, { next, year, updatedAt: at });
    tx.set(ref, note);
    // The original is marked, never overwritten: it stays readable, and the
    // pair explains itself to anyone reading the ledger later.
    tx.update(originalDoc.ref, { status: "credited" });

    return note;
  });
}
