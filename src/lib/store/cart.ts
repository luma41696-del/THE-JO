"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { CartItem, CurrencyCode, Product } from "@/types";
import { cartKey, clamp } from "@/lib/utils";
import {
  buildCartItem,
  designFor,
  hasDesigns,
  hasOptions,
  resolveSelection,
} from "@/lib/product";
import { track } from "@/lib/analytics/track";

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
  /** Ignored for a simple product, which has no options. */
  colorId?: string;
  sizeId?: string;
  /** The chosen artwork, on products that offer several. */
  designId?: string;
  /** Axes beyond colour, size and artwork, keyed by attribute id. */
  attributes?: Record<string, string>;
  quantity?: number;
};

/**
 * Why the cart would not do what was asked.
 *
 * The cart refuses silently far too easily — a stepper that simply stops
 * moving reads as a broken button. Every refusal is recorded so the UI can say
 * which rule applied, and the distinction between the two caps matters: "Limit
 * 1 per order" is a policy the customer can understand, while "Only 1 left" is
 * a scarcity claim that must be true.
 */
export type CartRejection = {
  key: string;
  productId: string;
  reason: "stock" | "per-order" | "unavailable";
  /** The cap that was hit, for "you can only add N". */
  max: number;
  at: number;
};

interface CartState {
  items: CartItem[];
  currency: CurrencyCode;
  /** Set while a line is being written, so buttons can show a pending state. */
  pendingKey: string | null;
  /** Bumped on every successful add — the navbar badge animates off this. */
  addedTick: number;
  lastAddedKey: string | null;

  /**
   * Returns the line, or `null` when the product could not be added. Callers
   * that need to explain the refusal read `lastRejection`.
   */
  add: (args: AddArgs) => CartItem | null;
  /** Why the most recent `add` or `setQuantity` was capped or refused. */
  lastRejection: CartRejection | null;
  clearRejection: () => void;
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
      lastRejection: null,

      add: ({
        product,
        colorId = "",
        sizeId = "",
        designId = "",
        attributes = {},
        quantity = 1,
      }) => {
        // A variable product is not purchasable until the choice resolves to a
        // real variant; a simple one has nothing to resolve, so both ids stay
        // empty and the line key is simply `id::`.
        if (hasOptions(product)) {
          const color = product.colors.find((c) => c.id === colorId);
          const size = product.sizes.find((s) => s.id === sizeId);
          if (!color || !size) return null;
          // An unchosen artwork is an unresolved purchase, exactly like an
          // unchosen size — the bench would not know what to embroider.
          if (hasDesigns(product) && !designFor(product, designId)) return null;
        } else if (product.type === "variable") {
          // Variable, but with no options left to pick — unbuyable, not "free".
          return null;
        }

        const selection = resolveSelection(product, colorId, sizeId, designId, attributes);
        const key = cartKey(product.id, colorId, sizeId, designId, attributes);

        if (!selection.buyable || selection.cap.max < 1) {
          set({
            lastRejection: {
              key,
              productId: product.id,
              reason: "unavailable",
              max: 0,
              at: Date.now(),
            },
          });
          return null;
        }

        const existing = get().items.find((i) => i.key === key);
        const wanted = (existing?.quantity ?? 0) + quantity;
        const granted = clamp(wanted, 1, selection.cap.max);

        const next: CartItem = existing
          ? {
              ...existing,
              quantity: granted,
              // Re-read the cap on every add: stock moves, and a line added
              // yesterday must not keep yesterday's ceiling.
              maxQuantity: selection.cap.max,
              maxReason: selection.cap.reason,
            }
          : buildCartItem(product, selection, colorId, sizeId, granted, designId, attributes);

        // Recorded here rather than at each button: every path into the bag
        // — product page, cross-sell shelf, fitting room — comes through this
        // one function, so nothing can be added without being counted.
        track("cart_add", {
          productId: product.id,
          sku: selection.sku,
          price: selection.price,
          currency: product.currency,
          quantity: granted,
        });

        set((state) => ({
          items: existing
            ? state.items.map((i) => (i.key === key ? next : i))
            : [next, ...state.items],
          addedTick: state.addedTick + 1,
          lastAddedKey: key,
          lastRejection:
            granted < wanted
              ? {
                  key,
                  productId: product.id,
                  reason: selection.cap.reason,
                  max: selection.cap.max,
                  at: Date.now(),
                }
              : null,
        }));

        return next;
      },

      clearRejection: () => set({ lastRejection: null }),

      remove: (key) => {
        const item = get().items.find((i) => i.key === key);
        if (item) {
          track("cart_remove", {
            productId: item.productId,
            sku: item.sku,
            price: item.unitPrice,
            quantity: item.quantity,
          });
        }
        set((state) => ({ items: state.items.filter((i) => i.key !== key) }));
      },

      setQuantity: (key, quantity) => {
        const item = get().items.find((i) => i.key === key);
        if (item && quantity > item.maxQuantity) {
          set({
            lastRejection: {
              key,
              productId: item.productId,
              reason: item.maxReason ?? "stock",
              max: item.maxQuantity,
              at: Date.now(),
            },
          });
        }

        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.key !== key)
              : state.items.map((i) =>
                  i.key === key ? { ...i, quantity: clamp(quantity, 1, i.maxQuantity) } : i,
                ),
        }));
      },

      increment: (key) => {
        const item = get().items.find((i) => i.key === key);
        if (item) get().setQuantity(key, item.quantity + 1);
      },

      decrement: (key) => {
        const item = get().items.find((i) => i.key === key);
        if (item) get().setQuantity(key, item.quantity - 1);
      },

      clear: () => set({ items: [], lastAddedKey: null, lastRejection: null }),

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
      // v3: lines gained a resolved SKU, a shipping class and a cap reason.
      version: 3,
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
        let state = persisted as Partial<CartState> | undefined;
        // Nothing stored yet, or unreadable: let the store's own defaults win.
        if (!state) return persisted as CartState;

        let items = state.items ?? [];

        if (version < 2) {
          const store = (process.env.NEXT_PUBLIC_DEFAULT_CURRENCY as CurrencyCode) || "JOD";
          items = items.filter((item) => item.currency === store);
          state = { ...state, currency: store };
        }

        if (version < 3) {
          /*
           * Pre-v3 lines carry a synthesised SKU (`PRODUCT-COLOR-SIZE`) that
           * never matched a real variant, and no shipping class. Both are now
           * load-bearing: the SKU is what the checkout re-prices against, and
           * a missing class would quietly under-charge shipping.
           *
           * They are dropped rather than repaired, because repairing them
           * needs the catalogue, which this synchronous migration does not
           * have. The customer re-adds from a product page and gets a correct
           * line — a bag that empties once is much better than an order that
           * ships a bulky coat at envelope rates.
           */
          items = [];
        }

        return { ...state, items } as CartState;
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
