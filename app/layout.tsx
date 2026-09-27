import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/lib/i18n";
import "./globals.css";

const satoshi = localFont({
  src: [
    {
      path: "../public/fonts/satoshi/satoshi-light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/satoshi-regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/satoshi-medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/satoshi/satoshi-bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const DESCRIPTION =
  "CatWallet（猫猫钱包）是一个免费开源的个人财务应用，用于追踪收入、支出、预算、目标和报告。";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "CatWallet（猫猫钱包）| 个人财务",
    template: "%s | CatWallet",
  },
  description: DESCRIPTION,
  keywords: [
    "personal finance",
    "expense tracker",
    "budget app",
    "open source finance",
    "self-hosted budget tracker",
    "finance dashboard",
    "free budget app",
    "nextjs finance app",
  ],
  alternates: {
    canonical: "http://localhost:3000",
  },
  openGraph: {
    type: "website",
    url: "http://localhost:3000",
    siteName: "CatWallet",
    title: "CatWallet（猫猫钱包）| 个人财务",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "CatWallet（猫猫钱包）| 个人财务",
    description: DESCRIPTION,
  },
  icons: {
    icon: [
      {
        url: "/catwallet-icon.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/catwallet-icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF9F1" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0D0E" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("catwallet-theme");var d=t==="dark"||t==="light"?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "CatWallet",
  alternateName: "猫猫钱包",
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description:
    "Free and open-source personal finance app. Track income, expenses, budgets, goals, and reports. Self-hostable.",
  inLanguage: "zh-CN",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "MYR",
  },
  url: "http://localhost:3000",
  sameAs: ["https://github.com/yueyue95/CatWallet-OSS"],
};

const IS_VERCEL_DEPLOYMENT = process.env.VERCEL === "1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${satoshi.variable} bg-background font-sans antialiased`}
      >
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_INIT_SCRIPT,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(STRUCTURED_DATA),
          }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <LanguageProvider>
            {children}
            <Toaster richColors position="top-right" />
          </LanguageProvider>
        </ThemeProvider>
        {IS_VERCEL_DEPLOYMENT && <Analytics />}
        {IS_VERCEL_DEPLOYMENT && <SpeedInsights />}
      </body>
    </html>
  );
}
