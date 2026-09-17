import type { NextConfig } from "next";

/* -------------------------------------------------------------------------- */
/*  Content Security Policy                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Built from the configured Firebase project rather than hard-coded, so a
 * clone pointed at a different project does not silently get a policy that
 * blocks its own auth popup.
 */
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "";
const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";

const origins = (...values: string[]) =>
  values.filter(Boolean).map((value) => (value.startsWith("http") ? value : `https://${value}`));

/**
 * What the browser is allowed to load, and from where.
 *
 * The three directives that do the most work here are the quiet ones:
 * `object-src 'none'` kills Flash-era plugin injection, `base-uri 'self'`
 * stops an injected `<base>` tag silently re-pointing every relative URL on
 * the page at an attacker, and `form-action 'self'` stops an injected form
 * posting a customer's details somewhere else. None of them cost anything.
 *
 * ## The honest limitation
 *
 * `script-src` still carries `'unsafe-inline'`. Removing it needs a per-request
 * nonce, and in the App Router a nonce forces *every* page to render
 * dynamically — this shop prerenders 87 of them, so that trade is a real
 * slowdown for every visitor in exchange for a defence against a bug class
 * that `dangerouslySetInnerHTML` (used here only for JSON-LD, which browsers
 * do not execute) does not currently expose. It is a deliberate position, not
 * an oversight: what this policy does buy is that an injected `<script src>`
 * pointing anywhere but this origin and Google's auth helpers is refused.
 */
/*
 * `'unsafe-eval'` in development only.
 *
 * Next's dev server evaluates modules through `eval()` for hot reloading, so
 * without this the local site does not boot at all. A production build emits
 * no `eval`, and shipping the allowance "because dev needs it" would hand back
 * the one script defence this policy actually buys.
 */
const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

/*
 * The Firebase emulators, in development only.
 *
 * They run on 127.0.0.1 over plain HTTP, which `connect-src 'self'` refuses —
 * so without this the whole emulator suite is unreachable from the browser and
 * anything that needs a throwaway account has to be tested against the live
 * project instead. Shipped once already and found the hard way.
 */
const devEmulators =
  process.env.NODE_ENV === "development"
    ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
    : "";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devEval} ${origins("apis.google.com", "www.gstatic.com", "www.google.com").join(" ")}`,
  // Tailwind emits a stylesheet, but React inline styles and the receipt's
  // measured page rule are inline by nature.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${origins(
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    "images.unsplash.com",
    "lh3.googleusercontent.com",
    "*.firebasestorage.app",
  ).join(" ")}`,
  `media-src 'self' blob: ${origins("firebasestorage.googleapis.com", "*.firebasestorage.app").join(" ")}`,
  // Firestore keeps a long-lived channel open; Auth and Storage are plain
  // HTTPS. The wildcard is on Google's own API host, not on the world.
  `connect-src 'self' ${origins(
    "*.googleapis.com",
    "*.firebaseio.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "*.firebasestorage.app",
    authDomain,
    storageBucket,
  ).join(" ")} wss://*.firebaseio.com wss://*.firebasestorage.app${devEmulators}`,
  // The Google sign-in popup and the reCAPTCHA that phone sign-in requires.
  `frame-src 'self' ${origins(authDomain, "accounts.google.com", "www.google.com").join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Replaces X-Frame-Options, which only ever supported one origin.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Firebase Storage + a placeholder source for local development.
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
    formats: ["image/avif", "image/webp"],
    // The demo catalogue ships generated SVG artwork. Serving SVG through the
    // image optimiser is only safe with the sandbox CSP below, which strips
    // scripting from anything rendered. `storage.rules` additionally rejects
    // SVG uploads, so customer-supplied files can never reach this path.
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    contentDispositionType: "attachment",
  },
  experimental: {
    optimizePackageImports: ["motion", "lottie-react"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          /*
           * Kept alongside `frame-ancestors` for the browsers that still only
           * understand this one. `DENY` rather than `SAMEORIGIN`: nothing here
           * frames itself, and the admin in an iframe is only ever an attack.
           */
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: csp },
          /*
           * Two years, subdomains included, and preload-eligible. Without it
           * the first request of a session is plain HTTP and interceptable —
           * the redirect to HTTPS happens after the request has been sent.
           */
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          /*
           * The fitting room uses the camera and picture search reads files,
           * so those stay. Everything else a page could ask for is refused
           * here rather than left to a future dependency to discover.
           */
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=(), interest-cohort=()",
          },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
