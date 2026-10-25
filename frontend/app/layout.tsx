import type { Metadata } from "next";
import { headers } from "next/headers";
import AppShell from "@/components/layout/AppShell";
import type { Viewer } from "@/lib/auth/access";
import { authEnabled, VIEWER_HEADER } from "@/lib/auth/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "MSME Payment Recovery",
  description: "Recovery Copilot for delayed payments under the MSMED Act (LS-03)",
};

async function readViewer(): Promise<Viewer | null> {
  if (!authEnabled) return null;
  const raw = (await headers()).get(VIEWER_HEADER);   // set by middleware.ts only
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as Viewer;
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const viewer = await readViewer();
  return (
    <html lang="en">
      <body className="antialiased">
        <AppShell viewer={viewer} authEnabled={authEnabled}>{children}</AppShell>
      </body>
    </html>
  );
}
