import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { MonitoringProvider } from "@/state/monitoring";
import { AppAuthProvider } from "@/state/auth";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Direct imports for reliable routing without dynamic chunk fetch failures
import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import NotFound from "./pages/NotFound";
import { AppLayout } from "./components/layout/AppLayout";
import Overview from "./pages/app/Overview";
import TopologyPage from "./pages/app/Topology";
import TrafficMonitor from "./pages/app/TrafficMonitor";
import SourceAnalysis from "./pages/app/SourceAnalysis";
import MitigationPage from "./pages/app/Mitigation";
import Experiments from "./pages/app/Experiments";
import EventLogs from "./pages/app/EventLogs";
import SettingsPage from "./pages/app/Settings";

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow hover:opacity-90 transition-opacity"
            >
              Reload application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Convex client.
 *
 * The app works without one. Everything the console measures is computed in the
 * browser; Convex only carries the account and the signed-in gate. So a missing
 * `VITE_CONVEX_URL` switches the app to a local session (see `@/state/auth`)
 * instead of failing, and the UI labels that state.
 */
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <AppAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <MonitoringProvider>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth
                      title="Sign in to open the operations console"
                      description="MicroburstHunter's live dashboard, topology, mitigation and experiments are available to signed-in users."
                    >
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<Overview />} />
                  <Route path="topology" element={<TopologyPage />} />
                  <Route path="traffic" element={<TrafficMonitor />} />
                  <Route path="sources" element={<SourceAnalysis />} />
                  <Route path="mitigation" element={<MitigationPage />} />
                  <Route path="experiments" element={<Experiments />} />
                  <Route path="events" element={<EventLogs />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </MonitoringProvider>
        </BrowserRouter>
        <Toaster />
      </AppAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
