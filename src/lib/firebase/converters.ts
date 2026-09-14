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

export const productConverter = withId<Product>();
export const categoryConverter = withId<Category>();
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
