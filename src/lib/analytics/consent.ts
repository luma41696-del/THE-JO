"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { ConsentState } from "@/types";

/**
 * Consent, as two separate questions.
 *
 * Behavioural analytics is about how the shop is used. Fitting-room processing
 * sends a photograph of a person's body somewhere. Bundling them into one
 * "accept" would mean a shopper who wanted size help has also agreed to be
 * tracked, which is not consent in any sense that matters — and would make the
 * fitting-room permission impossible to withdraw without also losing analytics.
 *
 * Three rules this module exists to enforce:
 *
 *  1. **Nothing is recorded before a choice is made.** The default is not
 *     "yes until told otherwise"; `decidedAt: 0` means undecided, and the
 *     event writer refuses to send anything in that state.
 *  2. **Declining is as easy as accepting.** Both are one tap on the banner.
 *     A "manage preferences" maze behind the decline is a dark pattern.
 *  3. **A policy change re-asks.** `POLICY_VERSION` is compared on read, so
 *     consent given to an older policy does not silently carry over.
 */

/** Bump when what is collected, or why, changes materially. */
export const POLICY_VERSION = 1;

const UNDECIDED: ConsentState = {
  analytics: false,
  fittingRoom: false,
  decidedAt: 0,
  version: POLICY_VERSION,
};

interface ConsentStore extends ConsentState {
  /** True once the visitor has answered the current policy version. */
  decided: () => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  set: (patch: Partial<Pick<ConsentState, "analytics" | "fittingRoom">>) => void;
  reset: () => void;
}

export const useConsent = create<ConsentStore>()(
  persist(
    (set, get) => ({
      ...UNDECIDED,

      decided: () => {
        const { decidedAt, version } = get();
        return decidedAt > 0 && version === POLICY_VERSION;
      },

      acceptAll: () =>
        set({
          analytics: true,
          fittingRoom: true,
          decidedAt: Date.now(),
          version: POLICY_VERSION,
        }),

      /*
       * Declining still records *that* a choice was made — otherwise the
       * banner would reappear on every page and wear the visitor down until
       * they accepted, which is consent by attrition.
       */
      rejectAll: () =>
        set({
          analytics: false,
          fittingRoom: false,
          decidedAt: Date.now(),
          version: POLICY_VERSION,
        }),

      set: (patch) =>
        set({ ...patch, decidedAt: Date.now(), version: POLICY_VERSION }),

      reset: () => set(UNDECIDED),
    }),
    {
      name: "net-sale:consent",
      version: POLICY_VERSION,
      storage: createJSONStorage(() => localStorage),
      /*
       * A stored choice from an older policy is discarded rather than
       * migrated. The visitor agreed to something different, and carrying it
       * forward would be claiming a consent that was never given.
       */
      migrate: () => UNDECIDED as never,
    },
  ),
);

/**
 * Read consent outside React — used by the event writer, which runs from
 * effects and handlers rather than from a component body.
 */
export function analyticsAllowed(): boolean {
  const state = useConsent.getState();
  return state.decidedAt > 0 && state.version === POLICY_VERSION && state.analytics;
}

export function fittingRoomAllowed(): boolean {
  const state = useConsent.getState();
  return state.decidedAt > 0 && state.version === POLICY_VERSION && state.fittingRoom;
}
