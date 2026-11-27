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
      viewBox="0 0 184 32"
      className="h-7 w-[156px] sm:h-8 sm:w-[184px]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M2 27V5h5l20 17V27h-5L7 13v14H2Z" fill="white" />
      <path d="M23 17.5c5-5.6 10.5-11.2 16.2-11.2 4.1 0 7.1 2.3 7.1 5.3 0 3.3-3.7 6.4-8.2 6.4-3.1 0-5.3-1.4-7.6-3.7" stroke="#1478E8" strokeWidth="4.2" strokeLinecap="round" />
      <path d="M31 14.5c-5 5.6-10.5 11.2-16.2 11.2-4.1 0-7.1-2.3-7.1-5.3 0-3.3 3.7-6.4 8.2-6.4 3.1 0 5.3 1.4 7.6 3.7" stroke="#1478E8" strokeWidth="4.2" strokeLinecap="round" />
      <text x="52" y="22.5" fill="white" fontFamily="Arial, sans-serif" fontSize="17" fontWeight="700" textDecoration="underline">notfinity.com</text>
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
