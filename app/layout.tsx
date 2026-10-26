import type { Metadata } from "next";
import { Onest, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ThemeInit } from "@/components/layout/ThemeInit";
import { Toaster } from "@/components/ui/toaster";
import { ToastStateProvider } from "@/components/ui/use-toast";
import { AuthProvider } from "@/lib/auth-context";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Arrow Mobile: Onest — свободный геометрический гротеск с кириллицей,
// ближайший к TildaSans с arwm.ru. Он же для заголовков: класс font-display
// в tailwind и h1–h4 в globals.css ссылаются на --font-sans.
// IBM Plex Mono — для кода и чисел.
const sans = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: BRAND_TAGLINE,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      // Класс `dark` ставит inline-скрипт ниже (до отрисовки) и ThemeInit —
      // поэтому разметка класса на сервере и клиенте может различаться.
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ThemeInit />
        {/* Мягкие пятна сирень → коралл (декоративные, не кликаются) */}
        <div className="app-glow" aria-hidden="true" />
        <ToastStateProvider>
          <AuthProvider>
            <div className="relative z-10">{children}</div>
          </AuthProvider>
          <Toaster />
        </ToastStateProvider>
      </body>
    </html>
  );
}
