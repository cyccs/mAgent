import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "跑步计划 Agent",
  description: "根据跑步目标和反馈生成每周训练计划",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
