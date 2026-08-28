import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://piora-ai-desktop.kexijiang46.chatgpt.site');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Piora — 免费开源的 AI 编程工作台', template: '%s · Piora' },
  description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。Piora 基于 Pi 运行时，开源、免费、本地优先。',
  applicationName: 'Piora',
  keywords: ['Piora', 'Pi', 'AI Agent', 'coding agent', 'AI 编程', 'AI 桌面应用', '多智能体', 'HarmonyOS 自动化', '开源', '免费'],
  authors: [{ name: 'Piora contributors', url: 'https://github.com/kexijiang/Piora' }],
  creator: 'Piora contributors',
  alternates: { canonical: '/' },
  icons: { icon: '/piora-icon.png', apple: '/piora-icon.png' },
  manifest: '/manifest.webmanifest',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: '/',
    siteName: 'Piora',
    title: 'Piora — 免费开源的 AI 编程工作台',
    description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'Piora — 免费开源的 AI 编程工作台' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Piora — 免费开源的 AI 编程工作台',
    description: '对话、改文件、审 Diff、查网页、控真机、组团队，一个桌面应用全部搞定。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
