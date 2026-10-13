import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import { MHMark } from "@/components/Wordmark";
import { ArrowRight, Loader2, Mail, UserX } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

const FACTS = [
  ["Detector", "rolling baseline · minimum rate · persistence"],
  ["Attribution", "byte share inside the burst window"],
  ["Policy", "adaptive rate cap with before/after verification"],
];

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn, localMode } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      if (localMode) {
        // Without a deployment there is no server to verify an address against,
        // so the console opens with a local session instead of a stray OTP step.
        await signIn("local");
        navigate(redirect);
        return;
      }
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      navigate(redirect);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signIn(localMode ? "local" : "anonymous");
      navigate(redirect);
    } catch (error) {
      console.error("Guest login error:", error);
      setError(
        `Failed to sign in as guest: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* brand column */}
      <div className="relative hidden flex-col justify-between border-r border-border bg-surface-2/80 p-10 lg:flex">
        <div className="fabric-grid pointer-events-none absolute inset-0 opacity-70" />
        <Link to="/" className="relative flex items-center gap-2.5">
          <MHMark className="size-8" active />
          <span className="text-[13.5px] font-semibold tracking-tight">
            Microburst<span className="text-primary">Hunter</span>
          </span>
        </Link>

        <div className="relative max-w-md">
          <span className="flex items-center gap-2">
            <span className="h-[2px] w-6 bg-primary" />
            <span className="label-caps text-muted-foreground">operations console</span>
          </span>
          <h1 className="mt-4 text-[30px] font-semibold leading-tight tracking-tight">
            Detect, attribute and cap microbursts in one instrument.
          </h1>
          <dl className="mt-7 divide-y divide-border/60 border-y border-border/60">
            {FACTS.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                <dt className="label-caps text-muted-foreground/70">{label}</dt>
                <dd className="data-mono text-right text-[11px] text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[10.5px] leading-4 text-muted-foreground/70">
            The browser build reports simulated measurements only. Live capture and Linux{" "}
            <code className="text-muted-foreground">tc</code> shaping belong to the separate Python
            backend.
          </p>
        </div>

        <span className="label-caps relative text-muted-foreground/50">
          MicroburstHunter · Computer Networks coursework
        </span>
      </div>

      {/* form column */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[380px]">
          <Link to="/" className="mb-6 flex items-center gap-2.5 lg:hidden">
            <MHMark className="size-7" active />
            <span className="text-[13px] font-semibold tracking-tight">
              Microburst<span className="text-primary">Hunter</span>
            </span>
          </Link>

          <div className="panel-edge rounded-md border border-border bg-surface">
            <div className="border-b border-border px-5 py-4">
              <span className="flex items-center gap-2">
                <span className="h-6 w-[3px] rounded-full bg-primary/70" />
                <span>
                  <span className="block text-[13px] font-semibold tracking-tight">
                    {step === "signIn" ? "Open the console" : "Verify your email"}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                    {step === "signIn"
                      ? localMode
                        ? "No backend configured — the console opens with a local session"
                        : "Sign in or create an account to reach the dashboard"
                      : `We sent a 6-digit code to ${step.email}`}
                  </span>
                </span>
              </span>
            </div>

            {step === "signIn" ? (
              <form onSubmit={handleEmailSubmit}>
                <div className="space-y-3 px-5 py-4">
                  <label
                    htmlFor="auth-email"
                    className="label-caps block text-muted-foreground"
                  >
                    Email address
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="auth-email"
                        name="email"
                        placeholder="name@example.com"
                        type="email"
                        className="rounded-sm pl-9"
                        disabled={isLoading}
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      size="icon"
                      className="rounded-sm"
                      disabled={isLoading}
                      aria-label={localMode ? "Open the console" : "Send verification code"}
                    >
                      {isLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                    </Button>
                  </div>

                  {error && (
                    <p className="rounded-sm border border-burst/40 bg-burst/[0.07] px-2.5 py-2 text-[11px] text-burst">
                      {error}
                    </p>
                  )}

                  {localMode && (
                    <p className="rounded-sm border border-warning/40 bg-warning/[0.07] px-2.5 py-2 text-[10.5px] leading-4 text-warning">
                      Local mode: this deployment has no Convex backend, so no email is sent. The
                      console session lives in this browser only.
                    </p>
                  )}

                  <div className="relative py-1">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="label-caps bg-surface px-2 text-muted-foreground/60">
                        or
                      </span>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2 rounded-sm"
                    onClick={handleGuestLogin}
                    disabled={isLoading}
                  >
                    <UserX className="size-3.5" />
                    Continue as guest
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleOtpSubmit}>
                <div className="space-y-4 px-5 py-4">
                  <input type="hidden" name="email" value={step.email} />
                  <input type="hidden" name="code" value={otp} />
                  <div className="flex justify-center">
                    <InputOTP
                      value={otp}
                      onChange={setOtp}
                      maxLength={6}
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                          const form = (e.target as HTMLElement).closest("form");
                          if (form) form.requestSubmit();
                        }
                      }}
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot key={index} index={index} />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error && (
                    <p className="rounded-sm border border-burst/40 bg-burst/[0.07] px-2.5 py-2 text-center text-[11px] text-burst">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full gap-2 rounded-sm"
                    disabled={isLoading || otp.length !== 6}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Verifying
                      </>
                    ) : (
                      <>
                        Verify code
                        <ArrowRight className="size-3.5" />
                      </>
                    )}
                  </Button>
                  <div className="flex items-center justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-sm px-2 text-muted-foreground"
                      onClick={() => setStep("signIn")}
                      disabled={isLoading}
                    >
                      Use a different email
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="px-0"
                      onClick={() => setStep("signIn")}
                    >
                      Resend
                    </Button>
                  </div>
                </div>
              </form>
            )}

            <div className="border-t border-border px-5 py-3">
              <p className="text-[10px] text-muted-foreground/70">
                Secured by{" "}
                <a
                  href="https://freebuff.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground underline transition-colors hover:text-primary"
                >
                  freebuff.com
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
