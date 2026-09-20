export const artifactPrefix = 'XiaoYiHarness';
export const releaseApiUrl = 'https://api.github.com/repos/kexijiang/Piora/releases/latest';

/** Only accept this brand's exact filename and canonical GitHub download URL. */
export function findBrandAsset(release, key) {
  if (!release || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) return undefined;
  const name = `${artifactPrefix}-${release.tag_name.slice(1)}-${key}`;
  const url = `https://github.com/kexijiang/Piora/releases/download/${release.tag_name}/${name}`;
  return release.assets.find(asset => asset.name === name && asset.browser_download_url === url);
}

export function isBrandRelease(release) {
  return ['win-x64-setup.exe', 'win-x64-portable.exe', 'win-x64.zip', 'linux-x64-portable.AppImage']
    .every(key => Boolean(findBrandAsset(release, key)));
}
