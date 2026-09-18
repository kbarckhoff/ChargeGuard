import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChargeGuard — CDM Audit Platform",
  description: "Comprehensive Charge Master Audit Review Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" style={{ fontFamily: "'Hanken Grotesk', system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
