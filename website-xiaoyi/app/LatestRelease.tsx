'use client';

import { useEffect, useMemo, useState } from 'react';
import { githubUrl, latestReleaseUrl } from './site-data';
import snapshot from './release-snapshot.json';
import { findBrandAsset, isBrandRelease, releaseApiUrl } from './release-assets.mjs';

type Asset = { name: string; browser_download_url: string; size: number };
type Release = { tag_name: string; html_url: string; published_at: string; assets: Asset[] };

const choices = [
  { key: 'win-x64-setup.exe', os: 'WINDOWS', title: 'Windows 安装版', note: '新手推荐 · 支持应用内更新', recommended: true },
  { key: 'win-x64-portable.exe', os: 'WINDOWS', title: 'Portable 单文件', note: '无需安装，下载即用', recommended: false },
  { key: 'win-x64.zip', os: 'WINDOWS', title: 'ZIP 解压版', note: '解压后运行 Piora.exe', recommended: false },
  { key: 'linux-x64-portable.AppImage', os: 'LINUX · X64', title: 'Linux AppImage', note: '赋予执行权限后直接运行', recommended: false },
] as const;

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

export default function LatestRelease() {
  const [release, setRelease] = useState<Release>(snapshot);
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(releaseApiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('release unavailable'))))
      .then((data: Release) => {
        if (isBrandRelease(data)) { setRelease(data); setRefreshed(true); }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const assets = useMemo(() => new Map(release?.assets.map((asset) => [asset.name, asset]) ?? []), [release]);
  const findAsset = (key: string): Asset | undefined => findBrandAsset(release, key);

  return (
    <div className="download-wrap">
      <div className="dl-head">
        <div>
          <span className="sec-tag">下载中心</span>
          <h2>选一个版本，马上开始</h2>
          <p>以下按钮直达 XiaoYiHarness 安装包。发行说明与源码由 Piora 共享仓库提供，下载后可用 SHA256SUMS.txt 验证完整性。</p>
        </div>
        <span className="release-pill">
          <i />
          {`${refreshed ? '最新版' : '已核验版本'} ${release.tag_name} · ${new Date(release.published_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}`}
        </span>
      </div>

      <div className="dl-grid">
        {choices.map((choice) => {
          const asset = findAsset(choice.key);
          return (
            <a
              key={choice.key}
              href={asset?.browser_download_url ?? latestReleaseUrl}
              className={`dl-card${choice.recommended ? ' recommended' : ''}`}
            >
              {choice.recommended ? <span className="rec-tag">推荐</span> : null}
              <span className="dl-os">{choice.os}</span>
              <h3>{choice.title}</h3>
              <p>{choice.note}</p>
              <div className="dl-foot">
                <span>{asset ? formatBytes(asset.size) : '前往发行页'}</span>
                <span className="dl-arrow" aria-hidden="true">↓</span>
              </div>
            </a>
          );
        })}
      </div>

      <div className="dl-note">
        <p style={{ margin: 0 }}><strong>温馨提示：</strong>当前安装包尚未做代码签名，Windows 首次运行可能显示信誉提示。只从官方发行页下载，并用 SHA256SUMS.txt 校验。</p>
        <div className="dl-links">
          <a href={release?.html_url ?? latestReleaseUrl}>查看发行说明 ↗</a>
          <a href={assets.get('SHA256SUMS.txt')?.browser_download_url ?? latestReleaseUrl}>下载校验文件 ↗</a>
          <a href={githubUrl} rel="noopener noreferrer">GitHub 仓库 ↗</a>
        </div>
      </div>
    </div>
  );
}
