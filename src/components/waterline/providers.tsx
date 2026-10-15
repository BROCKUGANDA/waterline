"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { useUi } from "@/stores/ui";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  const lang = useUi((s) => s.lang);

  // Arabic is a first-class language: RTL is designed, not mirrored (PRD 11.14)
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        {children}
        {/* Toast: non-blocking confirmation, 4s, bottom-centre mobile and
            bottom-right desktop (PRD 11.9). Never used for money movement. */}
        <Toaster
          position={typeof window !== "undefined" && window.innerWidth < 768 ? "bottom-center" : "bottom-right"}
          dir={lang === "ar" ? "rtl" : "ltr"}
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              fontFamily: "var(--font-inter)",
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
