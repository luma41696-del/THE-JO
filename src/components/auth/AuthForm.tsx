"use client";

import { useState, type FormEvent } from "react";
import { Link, useLocalizedRouter } from "@/components/ui/Link";
import { useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { EASE } from "@/lib/motion";
import { AuthError, requestPasswordReset, signIn, signInWithGoogle, signUp } from "@/lib/firebase/auth";
import { syncAdminSession } from "@/lib/firebase/session-client";
import type { User } from "firebase/auth";
import { Button } from "@/components/ui/Button";
import { AnimatedLogo } from "@/components/brand/AnimatedLogo";
import { BrandWave } from "@/components/brand/BrandWave";
import type { Locale } from "@/types";

/**
 * Sign in / create account.
 *
 * One component for both modes: the fields are nearly identical and keeping
 * them together guarantees the validation, error surface and redirect logic
 * cannot drift between the two.
 *
 * Errors are attached to the field they belong to, with copy a customer can act
 * on. A raw `auth/invalid-credential` under a form is a support ticket, not a
 * message.
 */

export function AuthForm({ mode, locale = "en" }: { mode: "signin" | "signup"; locale?: Locale }) {
  const reduced = useReducedMotion();
  const router = useLocalizedRouter();
  const params = useSearchParams();
  const rtl = locale === "ar";

  // Only ever redirect to a path on this origin — an open redirect here is a
  // credible phishing vector.
  const rawNext = params.get("next") ?? "/account";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/account";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; email?: string; password?: string; name?: string }>({});

  const isSignup = mode === "signup";

  async function finishSignIn(user: User) {
    const adminDestination = next === "/admin" || next.startsWith("/admin/");
    try {
      const admin = await syncAdminSession(user);
      if (adminDestination && !admin) {
        throw new AuthError(
          rtl ? "هذا الحساب لا يملك صلاحية الإدارة." : "This account does not have admin access.",
          "app/admin-access",
        );
      }
    } catch (error) {
      if (adminDestination) throw error;
    }
    router.push(next);
    router.refresh();
  }

  function handleError(error: unknown) {
    if (error instanceof AuthError) {
      setErrors(error.field ? { [error.field]: error.message } : { form: error.message });
    } else {
      setErrors({ form: rtl ? "حدث خطأ غير متوقع." : "Something went wrong. Please try again." });
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setLoading(true);

    try {
      const user = isSignup
        ? await signUp(name, email, password, locale)
        : await signIn(email, password);
      await finishSignIn(user);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setErrors({});
    setLoading(true);
    try {
      const user = await signInWithGoogle(locale);
      await finishSignIn(user);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    if (!email) {
      setErrors({ email: rtl ? "أدخل بريدك أولاً." : "Enter your email first." });
      return;
    }
    try {
      await requestPasswordReset(email);
      setResetSent(true);
    } catch (error) {
      handleError(error);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="bg-ink relative hidden overflow-hidden lg:block">
        <div className="absolute -start-20 -top-20 h-[36rem] w-[36rem] opacity-20">
          <BrandWave rings={4} color="var(--color-brand-bright)" speed={12} />
        </div>
        <div className="absolute end-[-10%] bottom-[-10%] h-[28rem] w-[28rem] opacity-15">
          <BrandWave rings={3} color="#ffffff" speed={16} />
        </div>

        <div className="relative flex h-full flex-col justify-between p-14">
          <Link href="/" className="flex items-center gap-3" aria-label="net sale — home">
            <AnimatedLogo tone="onDark" className="h-11 w-11" alwaysWave title={null} />
            <span className="font-display text-[1.0625rem] font-semibold tracking-[0.16em] text-white uppercase">
              net&nbsp;sale
            </span>
          </Link>

          <div className="max-w-md">
            <p className="font-editorial text-4xl leading-tight text-white italic">
              {rtl
                ? "قطع أقل، تدوم أطول."
                : "Buy less. Choose well. Make it last."}
            </p>
            <p className="mt-6 text-[0.9375rem] text-white/50">
              {rtl
                ? "احفظ مقاساتك مرة واحدة، ودع غرفة القياس تتولى الباقي."
                : "Save your measurements once and let the fitting room do the rest — members return 4× less often."}
            </p>
          </div>

          <p className="text-[0.75rem] tracking-[0.14em] text-white/30 uppercase">
            net sale — نت سيل
          </p>
        </div>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-5 py-24 md:px-12">
        <motion.div
          className="w-full max-w-sm"
          initial={reduced ? undefined : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE.brand }}
        >
          <div className="mb-8 lg:hidden">
            <Link href="/" aria-label="net sale — home">
              <AnimatedLogo className="h-12 w-12" title={null} />
            </Link>
          </div>

          <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
            {isSignup
              ? rtl
                ? "أنشئ حسابك"
                : "Create your account"
              : rtl
                ? "أهلاً بعودتك"
                : "Welcome back"}
          </h1>
          <p className="text-smoke mt-2 text-[0.9375rem]">
            {isSignup
              ? rtl
                ? "لحفظ المقاسات، وتتبّع الطلبات، والوصول المبكر للإصدارات."
                : "For saved sizes, order tracking and early access to drops."
              : rtl
                ? "سجّل الدخول لمتابعة طلباتك ومفضلتك."
                : "Sign in to pick up where you left off."}
          </p>

          {/* Google */}
          {(process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN_ENABLED === "true") && (
            <>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className={cn(
              "border-line bg-paper-raised text-ink mt-8 flex w-full cursor-pointer items-center justify-center gap-3",
              "rounded-pill border px-6 py-3.5 text-[0.9375rem] font-medium transition-all duration-300",
              "hover:border-ink/30 hover:shadow-lift disabled:opacity-50",
            )}
            data-cursor="hover"
          >
            <GoogleIcon />
            {rtl ? "المتابعة عبر Google" : "Continue with Google"}
          </button>

          <div className="my-7 flex items-center gap-4">
            <span className="bg-line h-px flex-1" />
            <span className="text-mist text-[0.75rem] tracking-wider uppercase">
              {rtl ? "أو" : "or"}
            </span>
            <span className="bg-line h-px flex-1" />
          </div>

            </>
          )}
          <form onSubmit={handleSubmit} noValidate className="mt-7 space-y-4">
            {isSignup && (
              <Field
                id="name"
                label={rtl ? "الاسم" : "Name"}
                autoComplete="name"
                value={name}
                onChange={setName}
                error={errors.name}
              />
            )}

            <Field
              id="email"
              label={rtl ? "البريد الإلكتروني" : "Email"}
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              error={errors.email}
            />

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="password" className="text-ink-muted text-[0.8125rem]">
                  {rtl ? "كلمة المرور" : "Password"}
                </label>
                {!isSignup && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-smoke hover:text-ink cursor-pointer text-[0.75rem] underline-offset-4 transition-colors hover:underline"
                    data-cursor="hover"
                  >
                    {rtl ? "نسيت كلمة المرور؟" : "Forgot?"}
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "password-error" : undefined}
                  className={cn(
                    "bg-paper-raised text-ink rounded-md w-full border py-3 ps-4 pe-12 text-[0.9375rem] outline-none",
                    "transition-colors duration-200",
                    errors.password ? "border-alert" : "border-line focus:border-brand",
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="text-mist hover:text-ink absolute end-3 top-1/2 -translate-y-1/2 cursor-pointer p-1 transition-colors"
                  data-cursor="hover"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" role="alert" className="text-alert mt-1.5 text-[0.75rem]">
                  {errors.password}
                </p>
              )}
              {isSignup && !errors.password && (
                <p className="text-mist mt-1.5 text-[0.75rem]">
                  {rtl ? "٨ أحرف على الأقل." : "At least 8 characters."}
                </p>
              )}
            </div>

            {isSignup && (
              <label className="text-smoke flex cursor-pointer items-start gap-2.5 pt-1 text-[0.8125rem]">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(event) => setMarketing(event.target.checked)}
                  className="accent-brand mt-0.5 h-3.5 w-3.5 cursor-pointer"
                />
                <span>
                  {rtl
                    ? "أرسلوا لي أخبار الإصدارات والعروض الخاصة."
                    : "Email me about new drops and private sales."}
                </span>
              </label>
            )}

            {errors.form && (
              <motion.p
                role="alert"
                className="bg-alert/10 text-alert rounded-md p-3 text-[0.8125rem]"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {errors.form}
              </motion.p>
            )}

            {resetSent && (
              <motion.p
                className="bg-mint/10 text-mint rounded-md p-3 text-[0.8125rem]"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {rtl
                  ? "أرسلنا رابط إعادة التعيين إلى بريدك."
                  : "Check your inbox for a reset link."}
              </motion.p>
            )}

            <Button type="submit" variant="brand" size="lg" fullWidth loading={loading} className="mt-2">
              {isSignup
                ? rtl
                  ? "إنشاء الحساب"
                  : "Create account"
                : rtl
                  ? "تسجيل الدخول"
                  : "Sign in"}
            </Button>
          </form>

          <p className="text-smoke mt-7 text-center text-[0.875rem]">
            {isSignup ? (
              <>
                {rtl ? "لديك حساب بالفعل؟" : "Already have an account?"}{" "}
                <Link href="/login" className="text-ink font-medium underline-offset-4 hover:underline">
                  {rtl ? "تسجيل الدخول" : "Sign in"}
                </Link>
              </>
            ) : (
              <>
                {rtl ? "ليس لديك حساب؟" : "New to net sale?"}{" "}
                <Link href="/register" className="text-ink font-medium underline-offset-4 hover:underline">
                  {rtl ? "أنشئ حساباً" : "Create an account"}
                </Link>
              </>
            )}
          </p>

          {isSignup && (
            <p className="text-mist mt-6 text-center text-[0.75rem] leading-relaxed">
              {rtl ? "بإنشائك حساباً فإنك توافق على " : "By creating an account you agree to our "}
              <Link href="/legal/terms" className="underline underline-offset-2">
                {rtl ? "الشروط" : "Terms"}
              </Link>
              {rtl ? " و" : " and "}
              <Link href="/legal/privacy" className="underline underline-offset-2">
                {rtl ? "سياسة الخصوصية" : "Privacy Policy"}
              </Link>
              .
            </p>
          )}
        </motion.div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink-muted mb-1.5 block text-[0.8125rem]">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          "bg-paper-raised text-ink rounded-md w-full border px-4 py-3 text-[0.9375rem] outline-none",
          "transition-colors duration-200",
          error ? "border-alert" : "border-line focus:border-brand",
        )}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-alert mt-1.5 text-[0.75rem]">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M1 9s3-5.5 8-5.5S17 9 17 9s-3 5.5-8 5.5S1 9 1 9Z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="9" cy="9" r="2.3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M3 3.5 15 14.5M7.2 7.3A2.3 2.3 0 0 0 9 11.3M1 9s3-5.5 8-5.5c1 0 1.9.2 2.7.5M16.2 6.4c.5.9.8 1.6.8 1.6s-3 5.5-8 5.5c-.5 0-1-.06-1.5-.17"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
