import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RCCES",
  description: "Comisiones para la Santa Misa",
  applicationName: "RCCES",
};

function NotfinityLogo() {
  return (
    <svg
      aria-label="notfinity.com"
      role="img"
      viewBox="0 0 190 32"
      className="h-7 w-[166px] sm:h-8 sm:w-[190px]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 27V5h5l14 14V5h5v22h-5L7 13v14H2Z" fill="white" />
      <path d="M18 12.2c4.4-4.6 9.7-7.3 14-7.3 4.2 0 7.1 2.5 7.1 5.9 0 3.5-3.7 7-8.2 7-2.9 0-5.1-1.3-7.1-3.5" stroke="#1478E8" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M39 19.8c-4.4 4.6-9.7 7.3-14 7.3-4.2 0-7.1-2.5-7.1-5.9 0-3.5 3.7-7 8.2-7 2.9 0 5.1 1.3 7.1 3.5" stroke="#1478E8" strokeWidth="4.5" strokeLinecap="round" />
      <text x="46" y="23" fill="white" fontFamily="Arial, sans-serif" fontSize="19" fontWeight="700" textDecoration="underline">notfinity.com</text>
    </svg>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-screen flex flex-col">
        {children}
        <footer className="mt-auto flex min-h-12 w-full items-center justify-center gap-3 border-t border-white/10 bg-[#17191a] px-4 py-2 text-sm text-gray-400">
          <span>Miembro de</span>
          <a href="https://notfinity.com" target="_blank" rel="noreferrer" aria-label="Visitar notfinity.com">
            <NotfinityLogo />
          </a>
        </footer>
      </body>
    </html>
  );
}
