import type { Locale } from "@/types";

/**
 * The one place a message leaves the building.
 *
 * Everything else about notifications — when they fire, what they say, whether
 * one was already sent — is pure and tested. This is the network call, kept
 * deliberately small so the untested surface is as thin as it can be.
 *
 * **Not exercised against a live account.** The Resend contract below is short
 * and stable, and it is implemented rather than stubbed because an email API
 * fails loudly and legibly in a way a generated image does not — a wrong
 * header comes back as a 401 with a message, not as a plausible-looking result.
 * But it has not run once, so nothing here swallows a failure: every attempt
 * writes its outcome, verbatim, onto the notification document, and the admin
 * shows it on the order. The first real send is what proves this, and if it is
 * wrong the shop will be able to see exactly how.
 */

export type NotifyProvider = "resend" | "none";

export interface ProviderConfig {
  provider: NotifyProvider;
  apiKey?: string;
  /** The From address. Must be on a domain verified with the provider. */
  from?: string;
}

function readConfig(): ProviderConfig {
  return {
    provider: (process.env.NOTIFY_PROVIDER ?? "none") as NotifyProvider,
    apiKey: process.env.NOTIFY_API_KEY,
    from: process.env.NOTIFY_FROM,
  };
}

/**
 * Whether a message can be sent, and what is missing if not.
 *
 * Answers with booleans and variable *names* — never the key itself, which
 * must not reach a client bundle or an admin screen.
 */
export function notifyStatus(): {
  configured: boolean;
  provider: NotifyProvider;
  missing: string[];
} {
  const config = readConfig();
  if (config.provider === "none") {
    return { configured: false, provider: "none", missing: ["NOTIFY_PROVIDER"] };
  }

  const missing: string[] = [];
  if (!config.apiKey) missing.push("NOTIFY_API_KEY");
  if (!config.from) missing.push("NOTIFY_FROM");

  return { configured: missing.length === 0, provider: config.provider, missing };
}

export interface SendInput {
  to: string;
  subject: string;
  body: string;
  locale: Locale;
}

export type SendResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * Send one message.
 *
 * Returns a result rather than throwing: a failed notification must never roll
 * back the order status that triggered it. The warehouse has already acted.
 */
export async function send(input: SendInput): Promise<SendResult> {
  const config = readConfig();
  const status = notifyStatus();

  if (!status.configured) {
    return {
      ok: false,
      error: `No mail provider configured (missing ${status.missing.join(", ")}).`,
      // Not retryable: retrying an unconfigured provider forever produces a
      // queue full of identical failures and hides the one real problem.
      retryable: false,
    };
  }

  try {
    /*
     * Resend's send endpoint. Chosen for the shape of the contract rather than
     * any affiliation: one POST, a bearer token, a JSON body, and errors that
     * arrive as JSON with a readable message.
     *
     * To use another provider, this switch is the only thing that changes —
     * `SendInput` and `SendResult` are what the rest of the system depends on.
     */
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: [input.to],
        subject: input.subject,
        text: input.body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        // The provider's own words, not a sanitised summary. "Domain not
        // verified" is actionable; "send failed" is not.
        error: `${response.status}: ${detail.slice(0, 300) || response.statusText}`,
        // 4xx is the shop's configuration and will fail identically on retry;
        // 5xx and 429 are worth another attempt.
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const data = (await response.json().catch(() => ({}))) as { id?: string };
    return { ok: true, ...(data.id ? { id: data.id } : {}) };
  } catch (error) {
    // A network error, a DNS failure, a timeout — all worth retrying.
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error.",
      retryable: true,
    };
  }
}
