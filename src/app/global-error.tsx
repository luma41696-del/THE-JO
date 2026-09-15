"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * The last line of defence.
 *
 * `[locale]/error.tsx` catches anything thrown inside a page. This catches
 * what happens when the root layout itself fails — a provider, a font, the
 * locale resolution — and at that point there is no layout left to render
 * into, which is why this supplies its own `<html>` and `<body>`.
 *
 * Without it, Next renders its own built-in fallback: an unstyled English
 * sentence reading "Application error: a client-side exception has occurred".
 * On a bilingual Jordanian shop that is the worst possible last impression,
 * and it gives the visitor nothing to do.
 *
 * Deliberately dependency-free. Nothing here imports a component, a provider
 * or a translation dictionary, because the reason we are here may well be that
 * one of those threw. Both languages are printed rather than chosen: the
 * locale lives in a provider that is, by definition, not available.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with your error reporter (Sentry, Firebase Crashlytics, …).
    console.error("[net sale] Global error", error.digest ?? error.message);
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#f4f1ea",
          color: "#1b1717",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          {/*
            Inline styles rather than classes. If the stylesheet is what
            failed, a class-based layout here would render as unstyled text —
            which is the exact failure this page exists to replace.
          */}
          <p
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#8a8078",
              margin: 0,
            }}
          >
            net sale · نت سيل
          </p>

          <h1 style={{ fontSize: "1.5rem", margin: "1.25rem 0 0", fontWeight: 600 }}>
            Something went wrong at our end
          </h1>
          <p lang="ar" dir="rtl" style={{ fontSize: "1.25rem", margin: "0.5rem 0 0", fontWeight: 600 }}>
            حدث خطأ لدينا
          </p>

          <p style={{ margin: "1.25rem 0 0", lineHeight: 1.6, color: "#4a4340" }}>
            Nothing you did caused this, and no order was affected. Try again,
            or come back in a moment.
          </p>
          <p lang="ar" dir="rtl" style={{ margin: "0.5rem 0 0", lineHeight: 1.8, color: "#4a4340" }}>
            لا علاقة لما فعلته بهذا، ولم يتأثر أي طلب. أعد المحاولة أو عد بعد قليل.
          </p>

          {/*
            The digest, not the message. A server error's message is redacted
            in production anyway, and printing it would only leak internals in
            development — while the digest is what matches a log entry.
          */}
          {error.digest && (
            <p style={{ margin: "1.25rem 0 0", fontSize: "0.75rem", color: "#8a8078" }}>
              Reference · المرجع <code>{error.digest}</code>
            </p>
          )}

          <div
            style={{
              marginTop: "2rem",
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                border: 0,
                borderRadius: "999px",
                padding: "0.75rem 1.5rem",
                background: "#1b1717",
                color: "#fff",
                fontSize: "0.875rem",
              }}
            >
              Try again · أعد المحاولة
            </button>
            {/*
              A plain anchor, not `next/link`.

              The lint rule preferring Link is right nearly everywhere and
              wrong here: this boundary replaces the root layout, so the
              router is part of what may have failed. A full page load is the
              escape that still works when client-side routing does not, and
              Next's own documentation for `global-error` uses a plain anchor
              for the same reason.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                borderRadius: "999px",
                padding: "0.75rem 1.5rem",
                border: "1px solid #d8d2c8",
                color: "#1b1717",
                textDecoration: "none",
                fontSize: "0.875rem",
              }}
            >
              Home · الرئيسية
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
