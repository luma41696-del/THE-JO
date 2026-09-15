import "server-only";

/**
 * The external try-on provider — the integration surface, not an implementation.
 *
 * Tier 2 of FITTING-ROOM.md: generating a photorealistic image of *this*
 * customer wearing *this* garment. That is a hosted diffusion model, it costs
 * roughly USD 0.04–0.10 per image, and it takes 5–20 seconds — so it is a job,
 * not a request.
 *
 * Everything around the call is written: configuration detection, the job
 * record, the state machine, retry with backoff, and the deletion path. The
 * call itself is a single clearly-marked function.
 *
 * **It never fabricates a result.** With no keys configured, `providerStatus()`
 * returns `not-configured` and the UI says the feature is unavailable. The one
 * thing that must not happen here is a plausible-looking placeholder image
 * presented as a try-on: the customer would believe it, and it would be a
 * picture of somebody else.
 */

export type ProviderName = "vertex-vto" | "none";

export type JobState = "queued" | "running" | "done" | "failed" | "not-configured";

export interface TryOnJob {
  id: string;
  uid: string;
  productId: string;
  variantSku?: string;
  state: JobState;
  /** Storage path of the result, when there is one. */
  resultPath?: string;
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Deleted automatically after this. */
  expiresAt: number;
}

/** How long a generated image is kept before it is eligible for deletion. */
export const RESULT_RETENTION_DAYS = 30;
export const MAX_ATTEMPTS = 3;

export interface ProviderConfig {
  provider: ProviderName;
  projectId?: string;
  location?: string;
  apiKey?: string;
}

/**
 * Read the provider configuration from the environment.
 *
 * Server-only, and the key is never returned to a caller that might serialise
 * it — `providerStatus()` is what the UI asks, and it answers with a boolean.
 */
function readConfig(): ProviderConfig {
  const provider = (process.env.VTO_PROVIDER ?? "none") as ProviderName;
  return {
    provider,
    projectId: process.env.VTO_PROJECT_ID,
    location: process.env.VTO_LOCATION ?? "us-central1",
    apiKey: process.env.VTO_API_KEY,
  };
}

/** Whether a real try-on can be attempted, and what is missing if not. */
export function providerStatus(): {
  configured: boolean;
  provider: ProviderName;
  missing: string[];
} {
  const config = readConfig();
  if (config.provider === "none") {
    return { configured: false, provider: "none", missing: ["VTO_PROVIDER"] };
  }

  const missing: string[] = [];
  if (!config.projectId) missing.push("VTO_PROJECT_ID");
  if (!config.apiKey) missing.push("VTO_API_KEY");

  return { configured: missing.length === 0, provider: config.provider, missing };
}

/**
 * Call the provider.
 *
 * **Unimplemented on purpose.** Wiring a request to an endpoint nobody has
 * credentials for would produce code that has never run once — it would look
 * finished, fail on first contact with the real API, and the failure would
 * land on whoever enabled it rather than on me.
 *
 * To implement, for Vertex AI:
 *
 *   POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}
 *        /locations/{location}/publishers/google/models/virtual-try-on:predict
 *
 *   body: { instances: [{ personImage: { bytesBase64Encoded },
 *                         productImages: [{ bytesBase64Encoded }] }],
 *           parameters: { sampleCount: 1 } }
 *
 *   auth: a service-account bearer token — NOT an API key in a query string.
 *
 * The response carries base64 images; write them to
 * `users/{uid}/fitting/results/` with the same owner-only rules as the source
 * photo, and set `resultPath` on the job.
 */
export interface ProviderInput {
  personImagePath: string;
  productImageUrl: string;
  config: ProviderConfig;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function callProvider(input: ProviderInput): Promise<{ ok: false; error: string } | { ok: true; resultPath: string }> {
  return {
    ok: false,
    error:
      "No try-on provider is implemented. See FITTING-ROOM.md — this needs a " +
      "Vertex AI project, a service-account credential and a per-image budget.",
  };
}

/**
 * Whether a failed job is worth retrying.
 *
 * A configuration error never is: retrying a missing API key three times just
 * makes the customer wait three times as long for the same answer. Only
 * transport-shaped failures get another go.
 */
export function shouldRetry(job: TryOnJob): boolean {
  if (job.attempts >= MAX_ATTEMPTS) return false;
  if (job.state !== "failed") return false;
  const error = (job.error ?? "").toLowerCase();
  if (error.includes("not implemented") || error.includes("no try-on provider")) return false;
  if (error.includes("credential") || error.includes("permission") || error.includes("quota")) {
    return false;
  }
  return true;
}

/** Exponential backoff, in milliseconds. */
export function retryDelay(attempts: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}
