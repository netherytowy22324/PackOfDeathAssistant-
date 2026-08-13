import { type ReactNode, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { setAuthTokenGetter } from "@workspace/api-client-react";
import AppLayout from "@/components/layout/app-layout";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Verifications from "@/pages/verifications";
import Messages from "@/pages/messages";
import Logs from "@/pages/logs";
import Config from "@/pages/config";
import Rcon from "@/pages/rcon";
import { toast } from '@/hooks/use-toast';

// Reactive auth state — shared across the whole tree
type AuthContextValue = {
  token: string | null;
  setToken: (token: string | null) => void;
};

let _globalSetToken: ((t: string | null) => void) | null = null;

// Wire up API client auth header
setAuthTokenGetter(() => localStorage.getItem("admin_token"));

function makeQueryClient(onUnauthorized: () => void) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error: any) => {
        if (error?.status === 401) {
          onUnauthorized();
        } else if (error?.message) {
          toast({ title: "Error", description: error.message, variant: "destructive" });
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error: any) => {
        if (error?.status === 401) {
          onUnauthorized();
        }
      },
    }),
  });
}

function Router({ token, setToken }: AuthContextValue) {
  if (!token) {
    return <Login onLogin={setToken} />;
  }

  return (
    <AppLayout onLogout={() => setToken(null)}>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/login" component={Dashboard} />
          <Route path="/verifications" component={Verifications} />
          <Route path="/messages" component={Messages} />
          <Route path="/logs" component={Logs} />
          <Route path="/config" component={Config} />
          <Route path="/rcon" component={Rcon} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppLayout>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem("admin_token")
  );

  const setToken = useCallback((newToken: string | null) => {
    if (newToken) {
      localStorage.setItem("admin_token", newToken);
    } else {
      localStorage.removeItem("admin_token");
    }
    setAuthTokenGetter(() => newToken);
    setTokenState(newToken);
  }, []);

  const [queryClient] = useState(() =>
    makeQueryClient(() => setToken(null))
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router token={token} setToken={setToken} />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
