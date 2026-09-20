import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { findBrandAsset, isBrandRelease } from '../app/release-assets.mjs';

const snapshot = JSON.parse(await readFile(new URL('../app/release-snapshot.json', import.meta.url), 'utf8'));

test('mixed-brand release always selects XiaoYiHarness regardless of order', () => {
  const pioraAssets = snapshot.assets.map(asset => ({ ...asset, name: asset.name.replace('XiaoYiHarness', 'Piora'), browser_download_url: asset.browser_download_url.replace('XiaoYiHarness', 'Piora') }));
  const mixed = { ...snapshot, assets: [...pioraAssets, ...snapshot.assets] };
  assert.equal(isBrandRelease(mixed), true);
  assert.equal(findBrandAsset(mixed, 'win-x64-setup.exe').name, 'XiaoYiHarness-0.5.1-win-x64-setup.exe');
});

test('reject missing brand, wrong version, untrusted URL and malformed responses', () => {
  assert.equal(isBrandRelease({ ...snapshot, assets: [] }), false);
  assert.equal(isBrandRelease({ ...snapshot, tag_name: 'v0.5.2' }), false);
  assert.equal(isBrandRelease({ ...snapshot, assets: snapshot.assets.map(asset => ({ ...asset, browser_download_url: 'https://example.com/installer.exe' })) }), false);
  for (const value of [null, {}, { assets: null }, { ...snapshot, tag_name: 'v0.5.2-beta.1' }]) assert.equal(isBrandRelease(value), false);
});

test('offline release snapshot contains all four real brand packages', () => {
  assert.equal(isBrandRelease(snapshot), true);
});
