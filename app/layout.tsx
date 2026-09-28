import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
export const metadata: Metadata = { title: "PromptLab · 编程实验", description: "AI 辅助编程实验与研究管理", icons: {icon:"/favicon.svg",shortcut:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}<Toaster position="top-center"/></body></html>}
