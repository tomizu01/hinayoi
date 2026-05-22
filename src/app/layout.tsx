import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hinayoi",
  description: "AI飲み会アプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="bg-black text-white">{children}</body>
    </html>
  );
}
