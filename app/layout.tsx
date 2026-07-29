import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shiftdeck — Schedule, crew & flights",
  description:
    "Turn work schedule photos into an automatically updating Apple Calendar subscription, then see your crew and flight board at a glance.",
  applicationName: "Shiftdeck",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Shiftdeck",
  },
  openGraph: {
    title: "Shiftdeck",
    description: "Your shift, crew & flights — at a glance.",
    type: "website",
    images: [{ url: "/og.png", width: 1680, height: 941, alt: "Shiftdeck app preview" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shiftdeck",
    description: "Your shift, crew & flights — at a glance.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const themeBootScript = `
  try {
    var savedTheme = localStorage.getItem("shiftdeck.theme");
    var activeTheme = savedTheme === "dark" ? "dark" : "light";
    var themeColor = activeTheme === "dark" ? "#17191d" : "#f4f5f7";
    document.documentElement.dataset.theme = activeTheme;
    document.documentElement.style.colorScheme = activeTheme;
    document.documentElement.style.backgroundColor = themeColor;
    var themeMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.setAttribute("name", "theme-color");
      document.head.appendChild(themeMeta);
    }
    themeMeta.setAttribute("content", themeColor);
    var statusMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!statusMeta) {
      statusMeta = document.createElement("meta");
      statusMeta.setAttribute("name", "apple-mobile-web-app-status-bar-style");
      document.head.appendChild(statusMeta);
    }
    statusMeta.setAttribute("content", activeTheme === "dark" ? "black-translucent" : "default");
  } catch (error) {}
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI).href, {
      scope: new URL("./", document.baseURI).pathname
    }).catch(function () {});
  }
`;

const launchPaintStyle = `
  html, body {
    margin: 0;
    background: #17191d;
    color-scheme: dark;
  }
  html[data-theme="light"],
  html[data-theme="light"] body {
    background: #f4f5f7;
    color-scheme: light;
  }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={{ backgroundColor: "#17191d", colorScheme: "dark" }}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: launchPaintStyle }} />
        <meta name="theme-color" content="#17191d" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
