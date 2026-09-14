"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { CartItem, CurrencyCode, Product } from "@/types";
import { cartKey, clamp } from "@/lib/utils";

/**
 * Cart state.
 *
 * Lives in `localStorage` so a guest cart survives a refresh, and syncs up to
 * `carts/{uid}` on sign-in (see `mergeServerCart`). Money shown here is for
 * display only — `/api/checkout` re-prices every line against Firestore before
 * an order is created, so a tampered localStorage value buys nothing.
 */

type AddArgs = {
  product: Product;
  colorId: string;
  sizeId: string;
  quantity?: number;
};

interface CartState {
  items: CartItem[];
  currency: CurrencyCode;
  /** Set while a line is being written, so buttons can show a pending state. */
  pendingKey: string | null;
  /** Bumped on every successful add — the navbar badge animates off this. */
  addedTick: number;
  lastAddedKey: string | null;

  add: (args: AddArgs) => CartItem | null;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  increment: (key: string) => void;
  decrement: (key: string) => void;
  clear: () => void;
  /** Union of the local guest cart and a cart loaded from Firestore. */
  mergeServerCart: (serverItems: CartItem[]) => void;

  count: () => number;
  subtotal: () => number;
  has: (key: string) => boolean;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      currency: (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as CurrencyCode) || "JOD",
      pendingKey: null,
      addedTick: 0,
      lastAddedKey: null,

      add: ({ product, colorId, sizeId, quantity = 1 }) => {
        const color = product.colors.find((c) => c.id === colorId);
        const size = product.sizes.find((s) => s.id === sizeId);
        if (!color || !size) return null;

        const key = cartKey(product.id, colorId, sizeId);
        const image = product.images.find((i) => i.colorId === colorId) ?? product.images[0];
        if (!image) return null;

        // Per-variant stock is authoritative; total stock is the safety net.
        const maxQuantity = Math.max(1, Math.min(product.totalStock, 10));

        const existing = get().items.find((i) => i.key === key);
        const next: CartItem = existing
          ? { ...existing, quantity: clamp(existing.quantity + quantity, 1, maxQuantity) }
          : {
              key,
              productId: product.id,
              sku: `${product.id}-${colorId}-${sizeId}`.toUpperCase(),
              slug: product.slug,
              title: product.title,
              image,
              colorId,
              colorName: color.name,
              sizeId,
              sizeLabel: size.label,
              unitPrice: product.price,
              compareAtPrice: product.compareAtPrice,
              currency: product.currency,
              quantity: clamp(quantity, 1, maxQuantity),
              maxQuantity,
              addedAt: Date.now(),
            };

        set((state) => ({
          items: existing
            ? state.items.map((i) => (i.key === key ? next : i))
            : [next, ...state.items],
          addedTick: state.addedTick + 1,
          lastAddedKey: key,
        }));

        return next;
      },

      remove: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),

      setQuantity: (key, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.key !== key)
              : state.items.map((i) =>
                  i.key === key ? { ...i, quantity: clamp(quantity, 1, i.maxQuantity) } : i,
                ),
        })),

      increment: (key) => {
        const item = get().items.find((i) => i.key === key);
        if (item) get().setQuantity(key, item.quantity + 1);
      },

      decrement: (key) => {
        const item = get().items.find((i) => i.key === key);
        if (item) get().setQuantity(key, item.quantity - 1);
      },

      clear: () => set({ items: [], lastAddedKey: null }),

      mergeServerCart: (serverItems) =>
        set((state) => {
          const merged = new Map(state.items.map((i) => [i.key, i]));
          for (const item of serverItems) {
            const local = merged.get(item.key);
            // Take the larger quantity rather than summing: a customer who
            // added 2 on their phone and 2 on desktop meant 2, not 4.
            merged.set(
              item.key,
              local
                ? { ...item, quantity: Math.max(local.quantity, item.quantity) }
                : item,
            );
          }
          return { items: [...merged.values()].sort((a, b) => b.addedAt - a.addedAt) };
        }),

      count: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
      subtotal: () => get().items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
      has: (key) => get().items.some((i) => i.key === key),
    }),
    {
      name: "net-sale:cart",
      // v2: the store moved from SAR to JOD.
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Transient UI flags must not be rehydrated from a previous session.
      partialize: (state) => ({ items: state.items, currency: state.currency }),

      /**
       * Drop any line priced in a currency the store no longer sells in.
       *
       * The alternative — relabelling the number — would be worse than useless:
       * `1890 SAR` is not `1890 JOD`, and silently carrying the figure across
       * would show a returning shopper a price roughly five times the real one.
       * Converting client-side would be worse still, since the catalogue price
       * is the only authoritative figure. Dropping the line means the customer
       * re-adds it at today's real price, which is the only correct outcome.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<CartState> | undefined;
        // Nothing stored yet, or unreadable: let the store's own defaults win.
        if (!state) return persisted as CartState;

        if (version < 2) {
          const store = (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as CurrencyCode) || "JOD";
          return {
            ...state,
            currency: store,
            items: (state.items ?? []).filter((item) => item.currency === store),
          } as CartState;
        }

        return state as CartState;
      },
    },
  ),
);

/**
 * Subscribe to the cart without tripping React's hydration mismatch check.
 * The persisted value is only available after mount, so the first client render
 * must match the server's empty cart.
 */
export function useCartHydrated() {
  return useCart.persist?.hasHydrated?.() ?? true;
}
