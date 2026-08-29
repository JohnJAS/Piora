import type { Metadata, Viewport } from "next";
import { BackgroundBootstrap } from "@/components/BackgroundBootstrap";
import { AppTooltip } from "@/components/AppTooltip";
import { PwaRegistration } from "@/components/PwaRegistration";
import { BACKGROUND_INITIALIZATION_SCRIPT } from "@/lib/backgrounds";
import { FONT_PREFERENCE_INITIALIZATION_SCRIPT } from "@/lib/font-preferences";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./theme-backgrounds.css";

const themeInitializationScript = `(function(){try{var a=["light","dark","starlight","ivory","doodle","fortune","midnight","forest","dream"],k=["dark","midnight","forest","dream"],f=function(x){return a.indexOf(x)>-1},t=null,v=localStorage.getItem("pi-theme:v1");if(v){try{var p=JSON.parse(v);if(p&&f(p.theme))t=p.theme}catch(_){}}if(!t){var l=localStorage.getItem("pi-theme");if(f(l))t=l}if(!t)t="light";var r=document.documentElement,d=k.indexOf(t)>-1;r.setAttribute("data-theme",t);r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(_){}})();`;
const surfaceInitializationScript = `(function(){try{if(location.pathname==="/desktop-pet"||location.pathname==="/desktop-companion-bubble")document.documentElement.classList.add("desktop-pet-document")}catch(_){}})();`;

export const metadata: Metadata = {
  title: "Piora",
  description: "Local-first desktop GUI for the Pi coding agent",
  applicationName: "Piora",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Piora",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: themeInitializationScript,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: FONT_PREFERENCE_INITIALIZATION_SCRIPT,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: surfaceInitializationScript,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: BACKGROUND_INITIALIZATION_SCRIPT,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        <BackgroundBootstrap />
        {children}
        <AppTooltip />
        <PwaRegistration />
      </body>
    </html>
  );
}
