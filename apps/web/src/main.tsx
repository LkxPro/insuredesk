import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc";
import "@/index.css";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      // Same-origin relative path: the Vite proxy forwards /trpc → api in dev
      // (see vite.config.ts), and a shared reverse proxy does so in prod.
      links: [httpBatchLink({ url: "/trpc" })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <App />
          <Toaster />
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Root element "#root" not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
