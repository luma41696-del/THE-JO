"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Wishlist.
 *
 * Product ids only — titles and prices are looked up from the catalogue at
 * render time, so a wishlist saved six months ago shows today's price rather
 * than a stale snapshot.
 *
 * Persisted locally for guests and mirrored to `users/{uid}.wishlist` once
 * signed in (see `syncFromServer`, called by the auth provider).
 */

interface WishlistState {
  ids: string[];
  toggle: (productId: string) => void;
  add: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
  has: (productId: string) => boolean;
  /** Union of local and server lists — a wish is never silently dropped. */
  syncFromServer: (serverIds: string[]) => string[];
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => ({
      ids: [],

      toggle: (productId) =>
        set((state) => ({
          ids: state.ids.includes(productId)
            ? state.ids.filter((id) => id !== productId)
            : [productId, ...state.ids],
        })),

      add: (productId) =>
        set((state) => ({
          ids: state.ids.includes(productId) ? state.ids : [productId, ...state.ids],
        })),

      remove: (productId) => set((state) => ({ ids: state.ids.filter((id) => id !== productId) })),

      clear: () => set({ ids: [] }),

      has: (productId) => get().ids.includes(productId),

      syncFromServer: (serverIds) => {
        const merged = Array.from(new Set([...get().ids, ...serverIds]));
        set({ ids: merged });
        return merged;
      },
    }),
    {
      name: "the-jo:wishlist",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
