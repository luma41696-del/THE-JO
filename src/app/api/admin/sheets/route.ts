import { NextResponse } from "next/server";

import { isAdminConfigured, verifyRequest } from "@/lib/firebase/admin";
import { driveFileId, sheetCsvUrl } from "@/lib/variant-import";

/**
 * Fetch a Google Sheet as CSV, on the server.
 *
 * ## Why the server does this
 *
 * The browser cannot. `docs.google.com` sends no CORS header for the export
 * endpoint, so a fetch from the page is blocked before it starts — and the
 * failure arrives as an opaque network error that looks like the sheet is
 * private when it is not.
 *
 * Doing it here also keeps the answer honest about *what came back*. A sheet
 * that is not shared does not return 403: it returns 200 with Google's sign-in
 * page, and a client that trusted the status would hand a spreadsheet parser a
 * lump of HTML and report "no columns found". The check below looks at the
 * body.
 *
 * ## Credentials
 *
 * There are none, and that is deliberate for the common case: a sheet shared
 * with anyone-who-has-the-link is readable by URL alone, which covers a
 * merchant pasting a link to their own stock sheet. A private sheet needs
 * OAuth, which needs a consent screen and a client secret — so it is refused
 * with an instruction rather than half-implemented behind a key nobody has
 * configured. `GOOGLE_SHEETS_API_KEY` is read if it is set and never required;
 * it is listed in `.env.example` with no value.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A stock sheet is text. Anything this size is not one. */
const MAX_BYTES = 5 * 1024 * 1024;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Firebase Admin is not configured here." },
      { status: 503 },
    );
  }

  const caller = await verifyRequest(request);
  if (!caller) return bad("Not signed in.", 401);
  if (caller.role !== "admin" && caller.role !== "staff") {
    return bad("This account cannot import.", 403);
  }

  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return bad("Malformed request body.");
  }

  const url = String(body.url ?? "").trim();
  if (!url) return bad("Paste a Google Sheets link.");

  const csvUrl = sheetCsvUrl(url);
  if (!csvUrl) {
    /*
     * A Drive *file* link is a different thing from a Sheets link and exports
     * differently, so it is named rather than swept into "invalid link" —
     * a merchant who pasted one has done something reasonable.
     */
    if (driveFileId(url)) {
      return bad(
        "That is a Drive file link. Open it in Google Sheets and copy the link from there.",
      );
    }
    return bad("That does not look like a Google Sheets link.");
  }

  const key = process.env.GOOGLE_SHEETS_API_KEY?.trim();
  const target = key ? `${csvUrl}&key=${encodeURIComponent(key)}` : csvUrl;

  try {
    const response = await fetch(target, {
      redirect: "follow",
      headers: { Accept: "text/csv,text/plain,*/*" },
      // A sheet that will not answer promptly is a sheet the merchant should
      // be told about, not one the request should hang on.
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      /*
       * These three answers mean three different things to the merchant, and
       * only one of them is their fault. A bare status number sends somebody
       * to search for "google sheets 410" instead of at the link they pasted.
       *
       * 410 is in here because a real one came back during testing: a
       * spreadsheet id that has been deleted answers Gone, not Not Found, and
       * "Google refused the request (410)" is not an instruction anyone can
       * act on.
       */
      if (response.status === 404 || response.status === 410) {
        return bad("That sheet no longer exists, or the link has a typo in it.", 502);
      }
      if (response.status === 401 || response.status === 403) {
        return bad(
          "That sheet is not shared. Open it, choose Share → Anyone with the link → Viewer, then try again.",
          403,
        );
      }
      return bad(
        `Google would not return that sheet (${response.status}). Try again in a moment.`,
        502,
      );
    }

    const text = await response.text();
    if (text.length > MAX_BYTES) return bad("That sheet is too large to import here.", 413);

    /*
     * The check the status code cannot make. A sheet that is not shared comes
     * back as 200 with a sign-in page, and handing that to a CSV parser
     * produces "no columns found" — which sends the merchant looking at their
     * column headers instead of at their sharing settings.
     */
    const looksLikeHtml = /^\s*<(!doctype|html)/i.test(text);
    if (looksLikeHtml) {
      return bad(
        "That sheet is not shared. Open it, choose Share → Anyone with the link → Viewer, then try again.",
        403,
      );
    }

    if (!text.trim()) return bad("That sheet is empty.");

    return NextResponse.json({ ok: true, csv: text, source: csvUrl });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "Google did not answer in time. Try again."
        : "That sheet could not be read.";
    return bad(message, 502);
  }
}
