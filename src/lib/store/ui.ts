"use client";

import { create } from "zustand";

import type { Locale } from "@/types";

/**
 * Ephemeral interface state — which overlay is open, what the cursor should
 * look like, whether the brand intro has played. Deliberately not persisted,
 * with the single exception of the intro flag (sessionStorage), because
 * replaying a 1.6s logo animation on every route change is a tax, not a treat.
 */

export type CursorMode = "default" | "hover" | "view" | "drag" | "text" | "hidden";

interface UIState {
  cartOpen: boolean;
  searchOpen: boolean;
  filtersOpen: boolean;
  mobileNavOpen: boolean;
  introDone: boolean;

  cursorMode: CursorMode;
  cursorLabel: string | null;

  locale: Locale;

  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  setSearchOpen: (open: boolean) => void;
  setFiltersOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  closeAll: () => void;

  setCursor: (mode: CursorMode, label?: string | null) => void;
  finishIntro: () => void;
  setLocale: (locale: Locale) => void;
}

const INTRO_KEY = "net-sale:intro-played";

function introAlreadyPlayed() {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export const useUI = create<UIState>()((set) => ({
  cartOpen: false,
  searchOpen: false,
  filtersOpen: false,
  mobileNavOpen: false,
  // Resolved on the client after mount; the server always renders `false`.
  introDone: false,

  cursorMode: "default",
  cursorLabel: null,

  locale: "en",

  openCart: () => set({ cartOpen: true, mobileNavOpen: false, searchOpen: false }),
  closeCart: () => set({ cartOpen: false }),
  toggleCart: () => set((s) => ({ cartOpen: !s.cartOpen })),
  setSearchOpen: (open) => set({ searchOpen: open, cartOpen: false }),
  setFiltersOpen: (open) => set({ filtersOpen: open }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open, cartOpen: false }),
  closeAll: () =>
    set({ cartOpen: false, searchOpen: false, filtersOpen: false, mobileNavOpen: false }),

  setCursor: (mode, label = null) => set({ cursorMode: mode, cursorLabel: label }),

  finishIntro: () => {
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode — the intro simply plays again next session */
    }
    set({ introDone: true });
  },

  setLocale: (locale) => set({ locale }),
}));

/** Read once on mount to decide whether the intro should run at all. */
export function shouldPlayIntro() {
  return !introAlreadyPlayed();
}

/** True while any overlay owns the screen — used to lock body scroll. */
export function useOverlayOpen() {
  return useUI((s) => s.cartOpen || s.searchOpen || s.mobileNavOpen);
}
