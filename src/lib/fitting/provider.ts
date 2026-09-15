import "server-only";

/**
 * The external try-on provider — Google Vertex AI Virtual Try-On.
 *
 * Tier 2 of FITTING-ROOM.md: generating a photorealistic image of *this*
 * customer wearing *this* garment. That is a hosted diffusion model, it costs
 * roughly USD 0.04–0.10 per image, and it takes 5–20 seconds — so it is a job,
 * not a request. Everything around the call — the job record, the state
 * machine, retry with backoff, deletion — is unchanged by this file's
 * implementation; only `callProvider` stopped being a stub.
 *
 * **It never fabricates a result.** With no credentials configured,
 * `providerStatus()` returns `configured: false`, the UI says the feature is
 * unavailable, and `callProvider` refuses. The one thing that must not happen
 * here is a plausible-looking placeholder presented as a try-on: the customer
 * would believe it, and it would be a picture of somebody else.
 *
 * ## Credentials
 *
 * Authentication is a **service account**, exchanged for a short-lived OAuth
 * token by `google-auth-library` — not an API key. `VTO_API_KEY` is gone: an
 * API key cannot call `:predict` on Vertex AI at all, and a key in a query
 * string ends up in access logs and proxy caches.
 *
 * The service-account JSON is read from the environment inside this module and
 * **never leaves it**: it is not placed on `ProviderConfig`, not returned by
 * `providerStatus()`, not included in any error string, and never logged. That
 * is why `ProviderConfig` carries only the project and the region — a shape
 * that cannot leak a key even if somebody serialises it into a response one
 * day. `server-only` above is the second half of that guarantee: if a Client
 * Component ever imports this file, the build fails rather than shipping the
 * credential to a browser.
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

/* -------------------------------------------------------------------------- */
/*  The Google contract                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The GA model id. Pinned, not floating.
 *
 * An unpinned model name is a silent behaviour change on somebody else's
 * release schedule — for a feature that costs money per call and produces a
 * picture of a customer's body, that is not a risk worth carrying for the
 * convenience of not editing one line.
 */
export const VTO_MODEL = "virtual-try-on-001";

/** The only scope Vertex prediction needs. */
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Google's inline-image ceiling for a `:predict` request.
 *
 * Checked before the request rather than after the rejection: a 7MB upload
 * that comes back as a 400 has already cost the customer the wait, and the
 * error Google returns for it is less specific than the one this can give.
 */
export const MAX_INLINE_BYTES = 7 * 1024 * 1024;

/**
 * JPEG and PNG only.
 *
 * Narrower than the storage rules, which also accept WebP and AVIF, because
 * this is what the model documents support for. Sending a format it will
 * reject wastes the round trip; sending one it silently mishandles would be
 * worse.
 */
export const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png"] as const;

export type AcceptedMime = (typeof ACCEPTED_MIME_TYPES)[number];

/**
 * Configuration the rest of the system may see.
 *
 * Deliberately **no credential field**. See the note at the top of the file:
 * the service-account JSON is read where it is used and never travels on an
 * object that something else might serialise, log, or hand to a client.
 */
export interface ProviderConfig {
  provider: ProviderName;
  projectId?: string;
  location?: string;
}

function readConfig(): ProviderConfig {
  const provider = (process.env.VTO_PROVIDER ?? "none") as ProviderName;
  return {
    provider,
    projectId: process.env.VTO_PROJECT_ID,
    // Virtual Try-On is region-restricted; the deployment sets this explicitly.
    location: process.env.VTO_LOCATION ?? "us-central1",
  };
}

/** Present and non-empty? Never the value itself. */
function hasCredentials(): boolean {
  return Boolean(process.env.VTO_SERVICE_ACCOUNT_JSON?.trim());
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

  /*
   * Variable *names* only. This list is rendered to the customer in the
   * fitting room when the feature is off, so it must never carry a value —
   * and the one value here is a private key.
   */
  const missing: string[] = [];
  if (!config.projectId) missing.push("VTO_PROJECT_ID");
  if (!hasCredentials()) missing.push("VTO_SERVICE_ACCOUNT_JSON");

  return { configured: missing.length === 0, provider: config.provider, missing };
}

/* -------------------------------------------------------------------------- */
/*  Pure helpers — the parts worth testing without a network                   */
/* -------------------------------------------------------------------------- */

/** The regional prediction endpoint for the pinned model. */
export function predictEndpoint(projectId: string, location: string): string {
  return (
    `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${VTO_MODEL}:predict`
  );
}

export function isAcceptedImage(mimeType: string | null | undefined): mimeType is AcceptedMime {
  if (!mimeType) return false;
  // Content types arrive with parameters attached — "image/jpeg; charset=..."
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(base);
}

export function withinInlineLimit(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= MAX_INLINE_BYTES;
}

/**
 * Does this path belong to the account the job is for?
 *
 * The person image is the most sensitive file the shop holds, and the path
 * arrives as a string on the job. Without this check, a caller that ever
 * accepted a path from a request could have the server read *another
 * customer's* body photograph and run it through a paid model — the Admin SDK
 * bypasses the storage rules that would otherwise stop exactly that.
 */
export function ownsFittingPath(uid: string, path: string): boolean {
  if (!uid || !path) return false;
  if (path.includes("..")) return false;
  const prefix = `users/${uid}/fitting/`;
  if (!path.startsWith(prefix)) return false;
  // One segment after the prefix: the storage rules match a single file name,
  // so anything deeper is a path the owner could not read back.
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("/");
}

/**
 * Where a generated image is written.
 *
 * The same flat `users/{uid}/fitting/` folder as the source photograph, and
 * that is deliberate rather than convenient. The two alternatives both break
 * something that already works:
 *
 *  - `users/{uid}/fitting/results/{file}` is **not matched by the storage
 *    rules**. `match /users/{uid}/fitting/{fileName}` is a single segment, so
 *    a result in a subfolder falls through to the default deny and the
 *    customer could never open their own try-on.
 *  - It would also survive deletion. `deleteFittingPhotos` lists the folder's
 *    items, which does not descend into prefixes — so "delete my photos" would
 *    quietly leave generated images of the customer's body behind, and the
 *    consent text promises otherwise.
 *
 * The `try-on-` prefix keeps the two distinguishable without a second rule.
 */
export function resultObjectPath(uid: string, mimeType: string, token: string): string {
  const extension = isAcceptedImage(mimeType) && mimeType.includes("png") ? "png" : "jpg";
  // The token is a job id or a timestamp — anything that makes two results
  // from one account distinct. Non-filename characters are dropped rather than
  // escaped: a path is not the place to be clever.
  const safe = token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || String(Date.now());
  return `users/${uid}/fitting/try-on-${safe}.${extension}`;
}

export interface InlineImage {
  base64: string;
  mimeType: AcceptedMime;
}

/**
 * The request body, exactly as the Virtual Try-On REST schema defines it.
 *
 * Kept as its own pure function so the shape is asserted in a test rather than
 * verified by reading it — a misplaced nesting level here is a 400 that only
 * appears in production, at cost.
 */
export function buildPredictBody(person: InlineImage, product: InlineImage) {
  return {
    instances: [
      {
        personImage: { image: { bytesBase64Encoded: person.base64 } },
        productImages: [{ image: { bytesBase64Encoded: product.base64 } }],
      },
    ],
    parameters: { sampleCount: 1 },
  };
}

export type PredictionRead =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; error: string };

/**
 * Read the generated image out of a prediction response.
 *
 * Handles the case that looks like success and is not: Vertex returns a
 * prediction with `raiFilteredReason` and no image when its safety filters
 * reject the input. Treating that as an empty result would surface as
 * "something went wrong" and be retried three times for the same answer.
 */
export function readPrediction(payload: unknown): PredictionRead {
  const predictions = (payload as { predictions?: unknown })?.predictions;
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return { ok: false, error: "Vertex returned no prediction." };
  }

  const first = predictions[0] as {
    bytesBase64Encoded?: unknown;
    mimeType?: unknown;
    raiFilteredReason?: unknown;
  };

  if (typeof first?.raiFilteredReason === "string" && first.raiFilteredReason.trim()) {
    return {
      ok: false,
      error: `Vertex filtered this request: ${first.raiFilteredReason.slice(0, 200)}`,
    };
  }

  const base64 = typeof first?.bytesBase64Encoded === "string" ? first.bytesBase64Encoded : "";
  if (!base64) {
    return { ok: false, error: "Vertex returned a prediction with no image." };
  }

  const mimeType = typeof first?.mimeType === "string" ? first.mimeType : "image/png";
  if (!isAcceptedImage(mimeType)) {
    return { ok: false, error: `Vertex returned an unexpected image type: ${mimeType}` };
  }

  return { ok: true, base64, mimeType };
}

/* -------------------------------------------------------------------------- */
/*  The call                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProviderInput {
  /**
   * The account the job belongs to — the *verified* uid from the job record,
   * never a value taken from a request body. It is what `personImagePath` is
   * checked against and where the result is written.
   */
  uid: string;
  personImagePath: string;
  productImageUrl: string;
  config?: ProviderConfig;
}

export type ProviderResult = { ok: false; error: string } | { ok: true; resultPath: string };

/**
 * A GoogleAuth client, built once per process.
 *
 * `google-auth-library` caches the access token it mints and refreshes it
 * before expiry, so this is also the token cache — a new client per call would
 * mean a token exchange per try-on.
 *
 * The parsed credential lives only inside this closure.
 */
let authClient: import("google-auth-library").GoogleAuth | undefined;

async function getAccessToken(): Promise<string> {
  const raw = process.env.VTO_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error("Missing credential: VTO_SERVICE_ACCOUNT_JSON is not set.");
  }

  if (!authClient) {
    let credentials: { client_email?: string; private_key?: string };
    try {
      credentials = JSON.parse(raw) as typeof credentials;
    } catch {
      /*
       * The parser's own message is not repeated. It quotes the text it choked
       * on, which here is a private key — a stack trace in a log is not where
       * that should end up.
       */
      throw new Error("Invalid credential: VTO_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }

    if (!credentials.client_email || !credentials.private_key) {
      throw new Error(
        "Invalid credential: VTO_SERVICE_ACCOUNT_JSON has no client_email or private_key.",
      );
    }

    const { GoogleAuth } = await import("google-auth-library");
    authClient = new GoogleAuth({ credentials, scopes: [CLOUD_PLATFORM_SCOPE] });
  }

  const token = await authClient.getAccessToken();
  if (!token) {
    throw new Error("Credential rejected: Google issued no access token for that service account.");
  }
  return token;
}

/** The customer's photograph, read with the Admin SDK. */
async function readPersonImage(uid: string, path: string): Promise<InlineImage> {
  if (!ownsFittingPath(uid, path)) {
    // Not "not found": saying which is a way of asking the server whether
    // another account's file exists.
    throw new Error("Permission denied: that photo does not belong to this account.");
  }

  const { getAdminApp } = await import("@/lib/firebase/admin");
  const { getStorage } = await import("firebase-admin/storage");

  const file = getStorage(getAdminApp()).bucket().file(path);

  const [exists] = await file.exists();
  if (!exists) throw new Error("The fitting photo is no longer in storage.");

  const [metadata] = await file.getMetadata();
  const mimeType = metadata.contentType ?? "";
  if (!isAcceptedImage(mimeType)) {
    throw new Error(`The fitting photo must be a JPEG or PNG (it is ${mimeType || "unknown"}).`);
  }

  const size = Number(metadata.size ?? 0);
  if (!withinInlineLimit(size)) {
    throw new Error(
      `The fitting photo is ${Math.round(size / 1024)}KB; the limit is ` +
        `${MAX_INLINE_BYTES / 1024 / 1024}MB.`,
    );
  }

  const [buffer] = await file.download();
  return { base64: buffer.toString("base64"), mimeType: mimeType.split(";")[0]!.trim() as AcceptedMime };
}

/** The garment shot, fetched server-side. */
async function readProductImage(url: string): Promise<InlineImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("The product image URL is not a URL.");
  }
  // https only: this fetch runs on the server, with the server's network
  // position, so the URL it is handed decides where that request goes.
  if (parsed.protocol !== "https:") {
    throw new Error("The product image must be served over https.");
  }

  const response = await fetch(parsed, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`The product image could not be fetched (${response.status}).`);
  }

  const mimeType = response.headers.get("content-type") ?? "";
  if (!isAcceptedImage(mimeType)) {
    throw new Error(`The product image must be a JPEG or PNG (it is ${mimeType || "unknown"}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!withinInlineLimit(buffer.byteLength)) {
    throw new Error(
      `The product image is ${Math.round(buffer.byteLength / 1024)}KB; the limit is ` +
        `${MAX_INLINE_BYTES / 1024 / 1024}MB.`,
    );
  }

  return {
    base64: buffer.toString("base64"),
    mimeType: mimeType.split(";")[0]!.trim() as AcceptedMime,
  };
}

/** Write the generated image into the owner-only fitting folder. */
async function saveResult(uid: string, base64: string, mimeType: string): Promise<string> {
  const { getAdminApp } = await import("@/lib/firebase/admin");
  const { getStorage } = await import("firebase-admin/storage");

  const path = resultObjectPath(uid, mimeType, `${Date.now()}`);
  const file = getStorage(getAdminApp()).bucket().file(path);

  await file.save(Buffer.from(base64, "base64"), {
    contentType: isAcceptedImage(mimeType) ? mimeType : "image/png",
    // Private by default, like every other object under `users/{uid}/`. The
    // storage rules already restrict reads to the owner; this makes sure the
    // object itself is not left publicly accessible by a bucket-level default.
    public: false,
    metadata: {
      cacheControl: "private, max-age=0, no-store",
      // No customer data in metadata — just enough to know what produced it.
      metadata: { generatedBy: VTO_MODEL },
    },
  });

  return path;
}

/**
 * Call the provider.
 *
 * Returns a result rather than throwing, because the caller is a job runner:
 * a failure has to be recorded on the job and weighed by `shouldRetry`, not
 * unwound as an exception.
 *
 * Every error string here is written to be read by whoever is on call — it
 * names the step that failed and the actionable detail — and to contain
 * neither the credential nor the customer's image. The wording is also load
 * bearing for retry: `shouldRetry` refuses another attempt when an error
 * mentions a credential, a permission or a quota, so those words appear on
 * exactly the failures that would fail identically a second time.
 */
export async function callProvider(input: ProviderInput): Promise<ProviderResult> {
  const config = input.config ?? readConfig();
  const status = providerStatus();

  if (!status.configured) {
    return {
      ok: false,
      error:
        `No try-on provider is configured (missing ${status.missing.join(", ")}). ` +
        "See FITTING-ROOM.md.",
    };
  }
  if (config.provider !== "vertex-vto") {
    return { ok: false, error: `Unknown try-on provider "${config.provider}".` };
  }

  const projectId = config.projectId ?? process.env.VTO_PROJECT_ID;
  const location = config.location ?? process.env.VTO_LOCATION ?? "us-central1";
  if (!projectId) {
    return { ok: false, error: "No try-on provider is configured (missing VTO_PROJECT_ID)." };
  }
  if (!input.uid) {
    return { ok: false, error: "A try-on job needs the account it belongs to." };
  }

  try {
    /*
     * Both images are prepared before the token is minted. The order matters
     * for cost and for latency: a photo that is the wrong format or too large
     * fails here, in milliseconds, instead of after an OAuth exchange and a
     * multi-megabyte upload to a paid endpoint.
     */
    const [person, product] = await Promise.all([
      readPersonImage(input.uid, input.personImagePath),
      readProductImage(input.productImageUrl),
    ]);

    const token = await getAccessToken();

    const response = await fetch(predictEndpoint(projectId, location), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(buildPredictBody(person, product)),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      /*
       * Google's own message, capped. "Publisher Model … is not found or your
       * project does not have access to it" is the difference between an
       * afternoon and five minutes; "prediction failed" is not.
       *
       * The words below are what `shouldRetry` reads. A 401/403 is a
       * credential or permission problem and will fail identically on retry; a
       * 429 is a quota; everything else is left transport-shaped so a 503 gets
       * another attempt.
       */
      const prefix =
        response.status === 401 || response.status === 403
          ? "Credential or permission rejected by Vertex"
          : response.status === 429
            ? "Vertex quota exhausted"
            : `Vertex returned ${response.status}`;
      return { ok: false, error: `${prefix}: ${detail.slice(0, 300) || response.statusText}` };
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const prediction = readPrediction(payload);
    if (!prediction.ok) return { ok: false, error: prediction.error };

    const resultPath = await saveResult(input.uid, prediction.base64, prediction.mimeType);
    return { ok: true, resultPath };
  } catch (error) {
    /*
     * Only the message, never the stack or the cause chain: a thrown error
     * from the auth library or the Storage SDK can carry request context, and
     * this string is written onto a job document that other code reads.
     */
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The try-on request failed.",
    };
  }
}

/**
 * Whether a failed job is worth retrying.
 *
 * A configuration error never is: retrying a missing credential three times
 * just makes the customer wait three times as long for the same answer. Only
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
