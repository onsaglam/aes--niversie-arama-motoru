import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AES — Üniversite Araştırma Paneli",
  description: "Almanya Eğitim Serüveni | Bremen",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 antialiased">
        {/* Üst şerit */}
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                   style={{ background: "var(--aes-navy)" }}>
                AES
              </div>
              <div>
                <p className="text-sm font-semibold leading-none" style={{ color: "var(--aes-navy)" }}>
                  Almanya Eğitim Serüveni
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Üniversite Araştırma Paneli</p>
              </div>
            </div>
            <div className="ml-auto text-xs text-slate-400">Bremen, Germany</div>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-7xl px-6 py-8">{children}</main>

        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-3 text-center text-xs text-slate-400">
            AES — Almanya Eğitim Serüveni · aes-kompass.com · Bremen
          </div>
        </footer>
      </body>
    </html>
  );
}
