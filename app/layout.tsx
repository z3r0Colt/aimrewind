import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Away Message",
  description: "An instant message mystery set in fall 2004. Every buddy is played by AI.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
