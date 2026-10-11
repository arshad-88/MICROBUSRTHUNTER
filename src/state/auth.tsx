import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  ConvexAuthProvider,
  useAuthActions,
  type ConvexAuthActionsContext,
} from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Session state for the app.
 *
 * MicroburstHunter is a browser-side instrument: the detector, simulator,
 * experiments and exports all run locally. Convex is used for the account and
 * the signed-in gate, so when `VITE_CONVEX_URL` is absent the app still runs —
 * with a local session instead of a server session. `localMode` says which one
 * is in effect so the UI can be honest about it.
 */
export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Doc<"users"> | null | undefined;
  /** True when there is no Convex deployment, so the session lives in the browser. */
  localMode: boolean;
  /** Same contract as Convex Auth's actions, so call sites do not branch on type. */
  signIn: ConvexAuthActionsContext["signIn"];
  signOut: ConvexAuthActionsContext["signOut"];
}

const AuthContext = createContext<AuthState | null>(null);

const LOCAL_SESSION_KEY = "microburst-hunter.session";

/**
 * A local session is the default: the console is the product, and gating it
 * behind a backend that is not configured would just show an empty preview.
 * Signing out is remembered so the sign-in flow can still be exercised.
 */
function readLocalSession(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_SESSION_KEY) !== "signed-out";
  } catch {
    return true;
  }
}

function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(readLocalSession);

  const signIn = useCallback<ConvexAuthActionsContext["signIn"]>(async () => {
    try {
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
    } catch {
      // Private mode / storage disabled: the in-memory session still works.
    }
    setSignedIn(true);
    return { signingIn: true };
  }, []);

  const signOut = useCallback(async () => {
    try {
      window.localStorage.setItem(LOCAL_SESSION_KEY, "signed-out");
    } catch {
      // Private mode / storage disabled: the in-memory session still works.
    }
    setSignedIn(false);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoading: false,
      isAuthenticated: signedIn,
      user: null,
      localMode: true,
      signIn,
      signOut,
    }),
    [signedIn, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Reads the real Convex session. Must sit inside `ConvexAuthProvider`. */
function ConvexAuthBridge({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

  const value = useMemo<AuthState>(
    () => ({
      isLoading: isLoading || user === undefined,
      isAuthenticated,
      user,
      localMode: false,
      signIn,
      signOut,
    }),
    [isLoading, isAuthenticated, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppAuthProvider({
  client,
  children,
}: {
  client: ConvexReactClient | null;
  children: ReactNode;
}) {
  if (client === null) {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }
  return (
    <ConvexAuthProvider client={client}>
      <ConvexAuthBridge>{children}</ConvexAuthBridge>
    </ConvexAuthProvider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AppAuthProvider>.");
  }
  return value;
}
