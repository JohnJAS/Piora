import Image from 'next/image';
import LatestRelease from './LatestRelease';
import PromptCard from './PromptCard';
import {
  coreFeatures,
  faqs,
  featureGroups,
  githubUrl,
  heroStats,
  latestReleaseUrl,
  promptRecipes,
  quickStartSteps,
  showcaseHarmony,
  showcaseThemes,
} from './site-data';

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'XiaoYiHarness',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows 10, Windows 11, Linux x64',
  description: '免费开源的 AI 编程工作台。集成智能对话、文件编辑、Git 审阅、内置浏览器、多智能体协作、计划任务与 HarmonyOS NEXT 真机自动化。',
  license: 'https://opensource.org/licenses/MIT',
  downloadUrl: latestReleaseUrl,
  codeRepository: githubUrl,
  author: { '@type': 'Organization', name: 'XiaoYiHarness contributors' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

function WorkspaceScreenshot() {
  return (
    <figure className="workspace-screenshot">
      <a href="/workspace-screenshot.png" target="_blank" rel="noopener noreferrer" aria-label="查看 XiaoYiHarness 工作区完整截图（在新标签页打开）">
        <Image
          src="/workspace-screenshot.png"
          width={1446}
          height={922}
          alt="XiaoYiHarness 实际工作区：左侧为新对话、搜索、群聊、项目与聊天列表，右侧为新任务首页及项目、提示词和模型选择输入框。"
          sizes="(max-width: 1200px) calc(100vw - 40px), 1160px"
          unoptimized
        />
      </a>
    </figure>
  );
}

export default function Home() {
  return (
    <main id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="site-header">
        <nav className="shell nav-bar" aria-label="主导航">
          <a href="#top" className="brand" aria-label="XiaoYiHarness 首页">
            <Image src="/xiaoyi-icon.png" width={34} height={34} alt="XiaoYiHarness" priority />
            <span>XiaoYiHarness</span>
            <small>开源</small>
          </a>
          <div className="nav-links">
            <a href="#features">产品功能</a>
            <a href="#quickstart">快速上手</a>
            <a href="#download">下载</a>
            <a href="#faq">常见问题</a>
            <a href={githubUrl} rel="noopener noreferrer">GitHub</a>
          </div>
          <a href="#download" className="nav-cta">免费下载 ↓</a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-grid-bg" aria-hidden="true" />
        <div className="shell">
          <div className="hero-intro">
          <div className="hero-copy">
          <span className="hero-badge">XIAOYIHARNESS / AI WORKSPACE</span>
          <h1>让 AI，<br /><span className="grad">真正替你干活。</span></h1>
          <p className="hero-lead">对话、改文件、审 Diff、查网页、控真机、组团队 —— XiaoYiHarness 把这一切装进一个桌面应用，过程看得见、结果可验证、数据留在本机。</p>
          <div className="hero-actions">
            <a href="#download" className="btn btn-primary">立即免费下载</a>
            <a href={githubUrl} className="btn btn-ghost" rel="noopener noreferrer">GitHub 源码 ↗</a>
          </div>
          <div className="hero-meta">
            <span><b>Windows</b> 10 / 11</span>
            <span><b>Linux</b> x64</span>
            <span><b>MIT</b> 开源协议</span>
            <span><b>0</b> 遥测 · 0 广告</span>
          </div>
          </div>
          <div className="hero-emblem" aria-hidden="true">
            <span className="emblem-label">OPEN SOURCE. LOCAL FIRST.</span>
            <Image src="/favicon.svg" width={300} height={300} alt="" priority />
            <span className="emblem-caption">XiaoYiHarness<span>你的 AI 编程工作台</span></span>
          </div>
          </div>
          <div className="workspace-caption"><span>从一句目标，到一次交付</span><span>真实界面 · 点击查看大图 ↗</span></div>
          <WorkspaceScreenshot />
        </div>
      </section>

      <div className="shell stats-band" aria-label="产品数据">
        <div className="stats-grid">
          {heroStats.map((stat) => (
            <div className="stat-cell" key={stat.label}><b>{stat.value}</b><span>{stat.label}</span></div>
          ))}
        </div>
      </div>

      <section id="features" className="section">
        <div className="shell">
          <div className="sec-head">
            <span className="sec-tag">为什么选择 XiaoYiHarness</span>
            <h2>一个应用，装下 AI 编程的全流程</h2>
            <p>不是又一个聊天框。XiaoYiHarness 基于 Pi 运行时打造，把会话、文件、Git、浏览器、设备和团队协作放进同一个工作区。</p>
          </div>
          <div className="feature-grid">
            {coreFeatures.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className={`icon-ball ${feature.tint}`} aria-hidden="true">{feature.icon}</span>
                <h3>{feature.title}</h3>
                <p>{feature.summary}</p>
                <ul>{feature.items.map((item) => <li key={item}>{item}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section soft">
        <div className="shell">
          <div className="show-row">
            <div className="show-copy">
              <span className="sec-tag">{showcaseThemes.tag}</span>
              <h2>{showcaseThemes.title}</h2>
              <p>{showcaseThemes.text}</p>
              <ul>{showcaseThemes.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </div>
            <div className="show-media">
              <Image src="/backgrounds-overview.webp" width={1968} height={906} alt="XiaoYiHarness 内置 20 张原创背景总览" sizes="(max-width: 1020px) 100vw, 55vw" />
              <span className="media-note">20 张原创背景 · 全部本地提供</span>
            </div>
          </div>
          <div className="show-row flip">
            <div className="show-copy">
              <span className="sec-tag">{showcaseHarmony.tag}</span>
              <h2>{showcaseHarmony.title}</h2>
              <p>{showcaseHarmony.text}</p>
              <ul>{showcaseHarmony.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </div>
            <div className="show-media">
              <Image src="/harmony-panel.png" width={620} height={920} alt="XiaoYiHarness HarmonyOS NEXT 设备控制面板" sizes="(max-width: 1020px) 100vw, 40vw" style={{ width: 'min(100%, 380px)', margin: '0 auto', display: 'block' }} />
              <span className="media-note">观察 → 操作 → 验证，全程可控</span>
            </div>
          </div>
        </div>
      </section>

      <section id="capabilities" className="section">
        <div className="shell">
          <div className="sec-head">
            <span className="sec-tag">功能全景</span>
            <h2>12 大能力域，一次看全</h2>
            <p>以下按真实产品边界整理，每一项都对应 XiaoYiHarness 当前的界面、运行时或第一方扩展。点击卡片展开细节。</p>
          </div>
          <div className="cap-list">
            {featureGroups.map((group, index) => (
              <details className="cap-card" key={group.id} open={index === 0}>
                <summary className="cap-top">
                  <span className="cap-num">{group.number}</span>
                  <div>
                    <h3>{group.title}</h3>
                    <p>{group.summary}</p>
                  </div>
                  <span className="cap-arrow" aria-hidden="true">＋</span>
                </summary>
                <div className="cap-body">
                  <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="quickstart" className="section soft">
        <div className="shell">
          <div className="sec-head">
            <span className="sec-tag">快速上手</span>
            <h2>五步开始你的第一次任务</h2>
            <p>不需要先理解 Agent、Session 或 Extension。先把模型连上，打开一个目录，用一句完整的目标开始。</p>
          </div>
          <ol className="steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {quickStartSteps.map((step, index) => (
              <li className="step" key={step.title}>
                <span className="step-num">{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.text}</p></div>
              </li>
            ))}
          </ol>

          <div className="mode-guide">
            <div className="mode-card"><span>日常对话</span><h3>问答与小修改</h3><p>适合日常问答、小改动和需要你逐轮判断的工作。</p></div>
            <div className="mode-card"><span>可选 Plans 扩展</span><h3>先规划，再动手</h3><p>在设置中启用 Plans 扩展，整理结构化方案，再按步骤执行。</p></div>
            <div className="mode-card"><span>可选 Goals 扩展</span><h3>持续执行到完成</h3><p>在设置中启用 Goals 扩展，记录任务目标和进度，便于后续对话继续。</p></div>
          </div>

          <div className="sec-head" style={{ marginTop: 76, marginBottom: 0 }}>
            <span className="sec-tag">提示词模板</span>
            <h2>不知道怎么说？直接复制</h2>
            <p>5 个高频场景的现成提示词，点一下复制，粘贴进 XiaoYiHarness 就能用。</p>
          </div>
          <div className="recipe-grid">
            {promptRecipes.map(([label, prompt]) => <PromptCard key={label} label={label} prompt={prompt} />)}
          </div>
        </div>
      </section>

      <section id="download" className="section">
        <div className="shell">
          <LatestRelease />
        </div>
      </section>

      <section id="ai-ready" className="shell" style={{ paddingBottom: 20 }}>
        <div className="ai-strip">
          <div>
            <h3>给人看，也给 AI 看</h3>
            <p>页面提供语义化 HTML 与结构化软件数据，并为搜索引擎、智能助手和文档工具准备了机器可读资料。</p>
          </div>
          <div className="ai-links">
            <a href="/llms.txt">llms.txt ↗</a>
            <a href="/features.json">features.json ↗</a>
            <a href="/sitemap.xml">sitemap.xml ↗</a>
          </div>
        </div>
      </section>

      <section id="faq" className="section">
        <div className="shell">
          <div className="sec-head">
            <span className="sec-tag">常见问题</span>
            <h2>开始前，你可能想知道</h2>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}<span className="faq-x" aria-hidden="true">＋</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="shell" style={{ paddingBottom: 10 }}>
        <div className="cta-band">
          <Image src="/xiaoyi-icon.png" width={72} height={72} alt="XiaoYiHarness 图标" />
          <h2>准备好让 AI 上班了吗？</h2>
          <p>免费、开源、本地优先。下载最新版，连接你的模型，从一句完整的目标开始。</p>
          <div className="cta-actions">
            <a href="#download" className="btn btn-white">免费下载 ↓</a>
            <a href={githubUrl} className="btn btn-ghost" rel="noopener noreferrer">查看源代码</a>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="shell footer-grid">
          <div className="footer-brand">
            <div className="brand"><Image src="/xiaoyi-icon.png" width={30} height={30} alt="" /><span>XiaoYiHarness</span></div>
            <p>免费开源的 AI 编程工作台，基于 Pi 运行时打造。你的代码、文件和数据，默认都留在你自己的电脑上。</p>
          </div>
          <div className="footer-col">
            <b>产品</b>
            <a href="#features">产品功能</a>
            <a href="#capabilities">功能全景</a>
            <a href="#quickstart">快速上手</a>
            <a href="#download">下载</a>
          </div>
          <div className="footer-col">
            <b>开发者</b>
            <a href={githubUrl} rel="noopener noreferrer">GitHub 仓库</a>
            <a href={`${githubUrl}/issues`} rel="noopener noreferrer">问题反馈</a>
            <a href={`${githubUrl}/releases`} rel="noopener noreferrer">版本发行</a>
            <a href="/llms.txt">AI 文档</a>
          </div>
          <div className="footer-col">
            <b>关于</b>
            <a href={`${githubUrl}/blob/main/LICENSE`} rel="noopener noreferrer">MIT 协议</a>
            <a href={`${githubUrl}/blob/main/SECURITY.md`} rel="noopener noreferrer">安全政策</a>
            <a href={`${githubUrl}/blob/main/CONTRIBUTING.md`} rel="noopener noreferrer">参与贡献</a>
          </div>
        </div>
        <div className="shell footer-bottom">
          <span>XiaoYiHarness · 基于 Piora · © 2026 Piora contributors · MIT License</span>
          <span>由社区独立维护，不隶属于 Pi、pi-web、OpenAI 或 Codex</span>
        </div>
      </footer>
    </main>
  );
}
