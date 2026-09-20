import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://xiaoyiharness.sjjworkspace.chatgpt.site');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'XiaoYiHarness — 免费开源的 AI 编程工作台', template: '%s · XiaoYiHarness' },
  description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。XiaoYiHarness 基于 Pi 运行时，开源、免费、本地优先。',
  applicationName: 'XiaoYiHarness',
  keywords: ['XiaoYiHarness', 'Pi', 'AI Agent', 'coding agent', 'AI 编程', 'AI 桌面应用', '多智能体', 'HarmonyOS 自动化', '开源', '免费'],
  authors: [{ name: 'XiaoYiHarness contributors', url: 'https://github.com/kexijiang/Piora' }],
  creator: 'XiaoYiHarness contributors',
  alternates: { canonical: '/' },
  icons: { icon: '/xiaoyi-icon.png', apple: '/xiaoyi-icon.png' },
  manifest: '/manifest.webmanifest',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: '/',
    siteName: 'XiaoYiHarness',
    title: 'XiaoYiHarness — 免费开源的 AI 编程工作台',
    description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。',

  },
  twitter: {
    card: 'summary',
    title: 'XiaoYiHarness — 免费开源的 AI 编程工作台',
    description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。',

  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
