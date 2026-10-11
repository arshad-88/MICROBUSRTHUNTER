import { Button } from "@/components/ui/button";
import { MHMark } from "@/components/Wordmark";
import { useAuth } from "@/hooks/use-auth";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

/**
 * Wraps a route that requires a signed-in user.
 *
 * Signed-out visitors see why the page is blocked on the page they landed on,
 * and sign-in returns them to it through `returnTo`. Pass
 * `redirectImmediately` for a route where the bounce is the better experience.
 */
export function RequireAuth({
  children,
  title = "Sign in to continue",
  description = "This page is only available to signed-in users.",
  redirectImmediately = false,
}: {
  children: ReactNode;
  /** Headline on the blocked screen. */
  title?: string;
  /** Says what the visitor gets by signing in. */
  description?: string;
  /** Skip the explanation and go straight to `/auth`. */
  redirectImmediately?: boolean;
}) {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <MHMark className="size-9" active={false} />
          <span className="label-caps text-muted-foreground">resolving session</span>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    const signInHref = `/auth?returnTo=${encodeURIComponent(returnTo)}`;

    if (redirectImmediately) {
      return <Navigate to={signInHref} replace />;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="panel-edge w-full max-w-[420px] rounded-md border border-border bg-surface">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2">
              <Lock className="size-3.5 text-muted-foreground" />
            </span>
            <div>
              <h1 className="text-[13.5px] font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="px-5 py-4">
            <p className="text-[11.5px] leading-5 text-muted-foreground">
              You will come straight back to this page once you are signed in.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button className="w-full rounded-sm" onClick={() => navigate(signInHref)}>
                Sign in
              </Button>
              <Button
                variant="ghost"
                className="w-full rounded-sm text-muted-foreground"
                onClick={() => navigate("/")}
              >
                Back to the overview page
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return children;
}
