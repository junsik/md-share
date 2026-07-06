import type { Metadata } from "next";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "md-share",
  description: "Markdown report rendering and sharing service"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
