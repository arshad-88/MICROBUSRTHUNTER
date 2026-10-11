/**
 * Render tests for the app shell.
 *
 * The console is a browser-side instrument: detection, mitigation, experiments
 * and exports all run locally. Convex only carries the account, so these tests
 * render the real route tree the way `main.tsx` does with no Convex client —
 * the configuration that used to produce a blank page.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { AppAuthProvider } from "@/state/auth";
import { MonitoringProvider } from "@/state/monitoring";
import { RequireAuth } from "@/components/RequireAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { SimulationEngine } from "@/simulation";
import Landing from "@/pages/Landing";
import AuthPage from "@/pages/Auth";
import Overview from "@/pages/app/Overview";
import TopologyPage from "@/pages/app/Topology";
import Experiments from "@/pages/app/Experiments";

/** The routes from `main.tsx`, minus the lazy loading and the browser. */
function renderApp(path: string) {
  return renderToStaticMarkup(
    <AppAuthProvider client={null}>
      <MonitoringProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth title="Sign in to open the operations console">
                  <AppLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Overview />} />
              <Route path="topology" element={<TopologyPage />} />
              <Route path="experiments" element={<Experiments />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MonitoringProvider>
    </AppAuthProvider>,
  );
}

describe("app shell without a Convex deployment", () => {
  test("the landing page renders and links into the console", () => {
    const html = renderApp("/");
    expect(html).toContain("Catch the burst");
    // A local session is already established, so the CTA skips the sign-in gate.
    expect(html).toContain("Open the console");
    expect(html).toContain('href="/dashboard"');
  });

  test("the auth page explains that the session is local", () => {
    const html = renderApp("/auth");
    expect(html).toContain("the console opens with a local session");
    expect(html).toContain("no email is sent");
  });

  test("the console renders behind RequireAuth on a local session", () => {
    const html = renderApp("/dashboard");
    expect(html).not.toContain("resolving session");
    expect(html).not.toContain("Sign in to open the operations console");
    expect(html).toContain("LOCAL (NO BACKEND)");
    expect(html).toContain("SIMULATED");
  });

  test("the nested console routes resolve", () => {
    expect(renderApp("/dashboard/topology")).toContain("fabric");
    expect(renderApp("/dashboard/experiments")).toContain("Experiment");
  });
});

describe("the simulation engine drives the rendered console", () => {
  test("a detected burst names the offending source", () => {
    const engine = new SimulationEngine();
    engine.start();
    for (let i = 0; i < 6; i += 1) engine.tick();
    engine.simulateBurst("h3");
    for (let i = 0; i < 10; i += 1) engine.tick();
    const snapshot = engine.getSnapshot();
    expect(snapshot.currentBurst?.hostName).toBe("H3");
    expect(snapshot.currentBurst?.peakMbps).toBeGreaterThan(0);
    expect(renderApp("/dashboard")).toContain("Overview");
  });
});
