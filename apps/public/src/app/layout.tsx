import { SiteShell } from "-/components/site-shell";
import { ThemeProvider } from "-/components/theme-provider";
import { cn } from "@sugt/ui/lib/utils";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";

import "@sugt/ui/globals.css";
import { Montserrat } from "next/font/google";

const sans = Montserrat({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "Beranda",
    template: "%s | SUGT - Sekolah Unggul Garuda Transformasi x DITSAMA ITB",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* Montserrat is loaded here rather than in `@sugt/ui`: `next/font` self-hosts it and
       belongs to the app that renders `<html>`. `.dark` belongs on this element for the
       same reason — `next-themes` toggles it here, client-side from `localStorage`
       (ADR-0014: the server HTML is shared across visitors and stays theme-agnostic), so
       `suppressHydrationWarning` covers the one attribute its pre-paint script writes
       before React hydrates. `@sugt/ui` still ships the token block and the `dark`
       variant and stops there; see `packages/ui/README.md`. */
    <html
      lang="id"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", "font-sans", sans.variable)}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <SiteShell>{children}</SiteShell>
        </ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
