import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seller heat map",
  description: "Seller density across the Buenos Aires metro area, for hub planning.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
