import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIM Rewind",
  description: "Your buddy list is back. An independent AOL and AIM inspired experience.",
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
