/**
 * Firestore <-> domain converters.
 *
 * This is the only layer allowed to know about `Timestamp`. Everything above
 * it works with plain `number` epoch millis, which keeps domain objects
 * serialisable across the server/client boundary — a raw `Timestamp` thrown at
 * a Client Component is a runtime error in the App Router.
 */

import {
  Timestamp,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type SnapshotOptions,
  type WithFieldValue,
} from "firebase/firestore";

import type { Banner, Category, Offer, Order, Outfit, Product, UserProfile } from "@/types";

/** Accepts Timestamp, Date, number or a serialised {seconds} shape. */
export function toMillis(value: unknown, fallback = 0): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "seconds" in value) {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds?: number };
    return seconds * 1000 + Math.floor((nanoseconds ?? 0) / 1e6);
  }
  return fallback;
}

/** Recursively replace every Timestamp in a document with epoch millis. */
function normaliseTimestamps<T>(input: unknown): T {
  if (input instanceof Timestamp) return input.toMillis() as T;
  if (Array.isArray(input)) return input.map((v) => normaliseTimestamps(v)) as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      out[key] = normaliseTimestamps(value);
    }
    return out as T;
  }
  return input as T;
}

/**
 * Build a converter for a document type whose `id` comes from the snapshot.
 * `id` is stripped on write so it is never duplicated into the document body.
 */
function withId<T extends { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(model: WithFieldValue<T>): DocumentData {
      const { id: _id, ...rest } = model as WithFieldValue<T> & { id?: string };
      void _id;
      return rest as DocumentData;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      const data = normaliseTimestamps<Record<string, unknown>>(snapshot.data(options));
      return { ...data, id: snapshot.id } as T;
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Backfills                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * A converter's job is to hand the app a *complete* domain object. A cast
 * alone does not do that: `{...data} as Product` type-checks perfectly while
 * returning a document with no `upsellIds`, and the first `.length` on it
 * throws inside a Server Component — which renders the whole route as "Something
 * went wrong" rather than one missing rail.
 *
 * That is not hypothetical. A deploy that adds a field always runs against
 * documents written before it: the code ships, the backfill has not, and every
 * product page is down in between. So new fields are defaulted here, at the
 * boundary, and the storefront degrades to "no upsells" instead of an error
 * page. Re-seeding fills in the real values; nothing waits on it.
 */

export const productConverter: FirestoreDataConverter<Product> = {
  toFirestore: withId<Product>().toFirestore,
  fromFirestore(snapshot, options): Product {
    const raw = normaliseTimestamps<Record<string, unknown>>(snapshot.data(options));
    const colors = Array.isArray(raw.colors) ? raw.colors : [];
    const sizes = Array.isArray(raw.sizes) ? raw.sizes : [];

    return {
      ...raw,
      id: snapshot.id,
      // A document with options is variable; one without is simple. That is
      // the same rule the admin applies, so an un-migrated product infers the
      // type it would have been given anyway.
      type: raw.type === "simple" || raw.type === "variable"
        ? raw.type
        : colors.length > 0 && sizes.length > 0
          ? "variable"
          : "simple",
      colors,
      sizes,
      // No SKU is worse than a derived one: it is printed on the invoice.
      sku: typeof raw.sku === "string" && raw.sku ? raw.sku : snapshot.id.toUpperCase(),
      upsellIds: Array.isArray(raw.upsellIds) ? raw.upsellIds : [],
      crossSellIds: Array.isArray(raw.crossSellIds) ? raw.crossSellIds : [],
      // Falling back to the leaf id keeps ancestry queries working on a
      // pre-tree document — it just cannot match against a parent yet.
      categoryPath: Array.isArray(raw.categoryPath) && raw.categoryPath.length > 0
        ? raw.categoryPath
        : [String(raw.categoryId ?? "")],
    } as Product;
  },
};

export const categoryConverter: FirestoreDataConverter<Category> = {
  toFirestore: withId<Category>().toFirestore,
  fromFirestore(snapshot, options): Category {
    const raw = normaliseTimestamps<Record<string, unknown>>(snapshot.data(options));
    const parentId = typeof raw.parentId === "string" ? raw.parentId : null;

    /*
     * `path` cannot be computed here — one converter call sees one document
     * and has no view of the tree. A one-level guess is the honest fallback:
     * correct for every root category, and for a child it yields
     * [parent, self], which is right for the two-level tree this store
     * actually has. `withComputedPaths` recomputes properly on write.
     */
    const path = Array.isArray(raw.path) && raw.path.length > 0
      ? (raw.path as string[])
      : parentId
        ? [parentId, snapshot.id]
        : [snapshot.id];

    return {
      ...raw,
      id: snapshot.id,
      parentId,
      path,
      depth: typeof raw.depth === "number" ? raw.depth : path.length - 1,
    } as Category;
  },
};
export const bannerConverter = withId<Banner>();
export const offerConverter = withId<Offer>();
export const orderConverter = withId<Order>();
export const outfitConverter = withId<Outfit>();

/** The user profile is keyed by `uid`, not `id`. */
export const userConverter: FirestoreDataConverter<UserProfile> = {
  toFirestore(model: WithFieldValue<UserProfile>): DocumentData {
    const { uid: _uid, role: _role, ...rest } = model as WithFieldValue<UserProfile> & {
      uid?: string;
      role?: string;
    };
    void _uid;
    // `role` is authoritative only as a custom claim set by a Cloud Function.
    // Dropping it here means a compromised client cannot write itself to admin
    // even if the security rules were ever loosened by mistake.
    void _role;
    return rest as DocumentData;
  },
  fromFirestore(snapshot, options): UserProfile {
    const data = normaliseTimestamps<Record<string, unknown>>(snapshot.data(options));
    return { ...data, uid: snapshot.id } as UserProfile;
  },
};
