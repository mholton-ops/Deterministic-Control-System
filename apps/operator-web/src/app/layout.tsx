import type { Metadata } from "next";
import { IBM_Plex_Mono, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { Navigation } from "../components/navigation";
import { RouteTransitionOverlay } from "../components/route-transition-overlay";
import { TruthGraphShell } from "../components/truth-graph-shell";
import { getApiBaseUrl } from "../lib/api";
import "./globals.css";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const sans = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "HALDN CONTROL",
  description:
    "Deterministic operational integrity workbench for traceable truth across operations and finance.",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${mono.variable} ${sans.variable}`}>
        <div className="mx-auto grid min-h-screen max-w-[1700px] grid-cols-1 gap-5 p-4 lg:grid-cols-[300px_1fr] lg:p-6">
          <aside className="rounded-2xl border border-surface-700/80 bg-surface-900/80 p-4 shadow-panel">
            <div className="mb-5 border-b border-surface-700/70 pb-4">
              <h1 className="font-mono text-lg uppercase tracking-[0.2em] text-surface-100">
                HALDN CONTROL
              </h1>
              <p className="mt-1 text-sm text-surface-200">
                Deterministic Operational Control System.
              </p>
            </div>
            <Navigation />
            <div className="mt-5 rounded-lg border border-surface-700/70 bg-surface-850/70 p-3 text-xs text-surface-200">
              <div className="font-mono uppercase tracking-wider text-surface-100">Control API</div>
              <div className="mt-1 break-all">{getApiBaseUrl()}</div>
              <div className="mt-2 text-surface-100">
                Deterministic demo data. Public abstraction of the ALIGN control model.
              </div>
              <div className="mt-2">
                <span className="font-mono uppercase tracking-wider text-surface-100">Truth graph:</span>{" "}
                The connected chain of evidence, custody state, valuation state, ledger movement, and settlement outcome behind a record.
              </div>
              <div className="mt-2">
                <Link className="text-status-info hover:underline" href="/audit">
                  Inspect transaction and evidence truth
                </Link>
              </div>
            </div>
          </aside>
          <main
            id="haldn-main-panel"
            className="relative min-w-0 min-h-[calc(100vh-2rem)] space-y-4 lg:min-h-[calc(100vh-3rem)]"
          >
            <Suspense fallback={<div className="h-0" />}>
              <TruthGraphShell>{props.children}</TruthGraphShell>
            </Suspense>
            <Suspense fallback={null}>
              <RouteTransitionOverlay />
            </Suspense>
          </main>
        </div>
      </body>
    </html>
  );
}

