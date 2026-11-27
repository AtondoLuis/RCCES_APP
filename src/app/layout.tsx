import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RCCES",
  description: "Comisiones para la Santa Misa",
  applicationName: "RCCES",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-screen flex flex-col">
        {children}
        <footer className="mt-auto flex min-h-12 w-full items-center justify-center gap-3 border-t border-white/10 bg-[#17191a] px-4 py-2 text-sm">
          <span className="font-normal text-[#a5aaaf]">Miembro de</span>
          <a
            href="https://notfinity.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visitar notfinity.com"
            className="inline-flex items-center gap-2 font-extrabold text-white underline underline-offset-2"
          >
            <img
              src="/notfinity-official-dark.svg"
              alt="Logo oficial de Notfinity"
              className="h-[30px] w-[42px] object-contain"
            />
            <span>notfinity.com</span>
          </a>
        </footer>
      </body>
    </html>
  );
}
