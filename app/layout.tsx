import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Shiftdeck — Schedule, crew & flights",
  description:
    "Turn work schedule photos into an editable Apple Calendar export, then see your crew and flight board at a glance.",
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
    statusBarStyle: "default",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
