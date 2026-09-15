"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * The coupon the customer has applied.
 *
 * Lives outside the cart page because it has to survive the walk to checkout.
 * It used to be local component state, so a customer who entered a code in the
 * bag and pressed "Proceed to checkout" silently lost the discount and paid
 * full price — with nothing on screen saying so.
 *
 * **Only the code is stored, never the offer document.** A persisted offer
 * would be a snapshot of terms that can change: a campaign paused overnight,
 * a redemption limit reached by someone else, a value the merchant corrected.
 * Keeping just the code forces every read to resolve it against the live
 * catalogue and re-evaluate, which is the only way the number in the bag and
 * the number on the order can agree.
 */

interface CouponState {
  /** The raw code as the customer typed it, or null. */
  code: string | null;
  setCode: (code: string) => void;
  clear: () => void;
}

export const useCoupon = create<CouponState>()(
  persist(
    (set) => ({
      code: null,
      setCode: (code) => set({ code: code.trim() || null }),
      clear: () => set({ code: null }),
    }),
    {
      name: "net-sale:coupon",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
