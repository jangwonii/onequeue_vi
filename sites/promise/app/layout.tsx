import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "우리의 약속",
  description: "사진으로 인증하고, 실패하면 약속한 벌칙 또는 완주 상금. 친구들과 함께 거는 7일의 미션.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
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
