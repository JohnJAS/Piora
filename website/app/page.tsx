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
  name: 'Piora',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Windows 10, Windows 11, Linux x64',
  description: '免费开源的 AI 编程工作台。集成智能对话、文件编辑、Git 审阅、内置浏览器、多智能体协作、计划任务与 HarmonyOS NEXT 真机自动化。',
  softwareVersion: '0.4.21',
  license: 'https://opensource.org/licenses/MIT',
  downloadUrl: latestReleaseUrl,
  codeRepository: githubUrl,
  author: { '@type': 'Organization', name: 'Piora contributors' },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

function ProductMockup() {
  return (
    <div className="product-stage" aria-label="Piora 工作区界面示意">
      <div className="app-window">
        <div className="win-bar">
          <div className="dots"><i /><i /><i /></div>
          <span className="win-title">Piora — 我的项目</span>
          <span className="win-live"><i />任务运行中</span>
        </div>
        <div className="win-body">
          <aside className="win-side" aria-hidden="true">
            <Image src="/piora-icon.png" width={30} height={30} alt="" priority />
            <i className="on" /><i /><i /><i /><i />
          </aside>
          <div className="win-nav" aria-hidden="true">
            <p>项目</p>
            <span className="on">◆ 我的项目</span>
            <span>◇ 官网重构</span>
            <span>◇ 移动端适配</span>
            <p style={{ marginTop: 14 }}>会话</p>
            <span className="on">修复导航回归</span>
            <span>周报整理</span>
          </div>
          <div className="win-chat" aria-hidden="true">
            <div className="chat-head"><b>修复导航回归</b><span className="mode-tag">目标模式</span></div>
            <div className="bubble-user">检查导航状态，修复刷新后的会话恢复问题，并跑完所有测试。</div>
            <div className="card-agent">
              <b>Piora 正在执行</b>
              <ul>
                <li className="done"><i>✓</i>定位会话恢复路径</li>
                <li className="done"><i>✓</i>更新状态协调逻辑</li>
                <li className="run"><i>●</i>运行回归测试（24/24）</li>
              </ul>
            </div>
            <div className="chat-input"><span>描述你的目标，或随时下达新指令…</span><kbd>Ctrl ↵</kbd></div>
          </div>
          <div className="win-files" aria-hidden="true">
            <p>改动文件</p>
            <div><span>router.ts</span><em className="mod">M+42</em></div>
            <div className="on"><span>session.ts</span><em className="add">+128</em></div>
            <div><span>nav.test.ts</span><em className="add">+36</em></div>
            <div><span>legacy.ts</span><em className="del">-64</em></div>
          </div>
        </div>
      </div>
      <div className="float-toast toast-check"><i>✓</i><p style={{ margin: 0 }}><b>测试全部通过</b>24/24 · 无失败用例</p></div>
      <div className="float-toast toast-diff"><i>⌥</i><p style={{ margin: 0 }}><b>3 个文件已更新</b>点击查看 Diff</p></div>
    </div>
  );
}

export default function Home() {
  return (
    <main id="top">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="site-header">
        <nav className="shell nav-bar" aria-label="主导航">
          <a href="#top" className="brand" aria-label="Piora 首页">
            <Image src="/piora-icon.png" width={34} height={34} alt="Piora" priority />
            <span>Piora</span>
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
          <span className="hero-badge"><i />开源 · 免费 · 本地优先</span>
          <h1>免费开源的 AI 编程工作台<br /><span className="grad">让 AI 真正替你干活</span></h1>
          <p className="hero-lead">对话、改文件、审 Diff、查网页、控真机、组团队 —— Piora 把这一切装进一个桌面应用，过程看得见、结果可验证、数据留在本机。</p>
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
          <ProductMockup />
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
            <span className="sec-tag">为什么选择 Piora</span>
            <h2>一个应用，装下 AI 编程的全流程</h2>
            <p>不是又一个聊天框。Piora 基于 Pi 运行时打造，把会话、文件、Git、浏览器、设备和团队协作放进同一个工作区。</p>
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
              <Image src="/backgrounds-overview.webp" width={1968} height={906} alt="Piora 内置 20 张原创背景总览" sizes="(max-width: 1020px) 100vw, 55vw" />
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
              <Image src="/harmony-panel.png" width={620} height={920} alt="Piora HarmonyOS NEXT 设备控制面板" sizes="(max-width: 1020px) 100vw, 40vw" style={{ width: 'min(100%, 380px)', margin: '0 auto', display: 'block' }} />
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
            <p>以下按真实产品边界整理，每一项都对应 Piora 当前的界面、运行时或第一方扩展。点击卡片展开细节。</p>
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
            <div className="mode-card"><span>普通模式</span><h3>问答与小修改</h3><p>适合日常问答、小改动和需要你逐轮判断的工作。</p></div>
            <div className="mode-card"><span>计划模式</span><h3>先规划，再动手</h3><p>只读分析需求，给出可编辑、可审批的结构化实施方案。</p></div>
            <div className="mode-card"><span>目标模式</span><h3>持续执行到完成</h3><p>适合目标明确的复杂任务，未完成或未阻塞就会继续推进。</p></div>
          </div>

          <div className="sec-head" style={{ marginTop: 76, marginBottom: 0 }}>
            <span className="sec-tag">提示词模板</span>
            <h2>不知道怎么说？直接复制</h2>
            <p>5 个高频场景的现成提示词，点一下复制，粘贴进 Piora 就能用。</p>
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
          <Image src="/piora-icon.png" width={72} height={72} alt="Piora 图标" />
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
            <div className="brand"><Image src="/piora-icon.png" width={30} height={30} alt="" /><span>Piora</span></div>
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
          <span>© 2026 Piora contributors · MIT License</span>
          <span>由社区独立维护，不隶属于 Pi、pi-web、OpenAI 或 Codex</span>
        </div>
      </footer>
    </main>
  );
}
