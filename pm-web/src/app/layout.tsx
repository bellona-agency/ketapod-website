import type { Metadata, Viewport } from "next";

import { AuthProvider } from "@/lib/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "تخته کارها | کتاپاد",
    template: "%s | تخته کارها",
  },
  description: "ابزار داخلی مدیریت پروژه و کارهای تیم کتاپاد.",
  // The tool is internal and lives on a subdomain that must never show
  // up in a search result.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0f11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
