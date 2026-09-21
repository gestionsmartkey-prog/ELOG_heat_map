import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mapa de sellers · ELOG Group",
  description: "Densidad de sellers en AMBA para decidir dónde poner nodos de colecta.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className="h-full">
      <body className="h-full min-h-full bg-papel text-carbon">{children}</body>
    </html>
  );
}
