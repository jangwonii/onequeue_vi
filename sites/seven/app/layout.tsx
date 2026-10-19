import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEVEN — 친구와 함께하는 7일",
  description: "친구들과 약속을 확인하고 같은 7일 동안 루틴을 함께 지켜보세요.",
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
