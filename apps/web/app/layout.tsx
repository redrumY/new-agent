import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Z-Agent - Learn Agent Development",
  description: "Build intelligent agents with Plan/Build architecture",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
