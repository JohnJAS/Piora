import assert from 'node:assert/strict';
import test from 'node:test';
import { createAsyncSnapshotCache } from './async-snapshot-cache.ts';

test('coalesces concurrent loads and expires from completion, not request time', async t => {
  let now=0, loads=0, finish;
  t.mock.method(Date,'now',()=>now);
  const cache=createAsyncSnapshotCache(1000);
  const load=()=>{loads++;return new Promise(resolve=>{finish=resolve;});};
  const a=cache.get('repo',load), b=cache.get('repo',load);
  assert.equal(a,b); await Promise.resolve(); assert.equal(loads,1);
  now=5000; finish({files:[]}); await a;
  assert.equal(cache.get('repo',load),a);
  now=6001; const fresh=cache.get('repo',async()=>({files:['a']}));
  assert.notEqual(fresh,a); assert.deepEqual(await fresh,{files:['a']});
});

test('invalidation fences late loads, failures retry, and capacity evicts old snapshots', async () => {
  const cache=createAsyncSnapshotCache(10000,2);
  let finish;
  const old=cache.get('repo',()=>new Promise(resolve=>{finish=resolve;}));
  await Promise.resolve(); cache.invalidate();
  const current=cache.get('repo',async()=> 'new');
  finish('old'); await old; await current;
  assert.equal(await cache.get('repo',async()=> 'wrong'),'new');
  await assert.rejects(cache.get('bad',async()=>{throw new Error('temporary');}));
  assert.equal(await cache.get('bad',async()=> 'recovered'),'recovered');
  await cache.get('third',async()=>3);
  assert.equal(await cache.get('repo',async()=> 'reloaded'),'reloaded');
});

test('peek returns only in-flight or fresh entries and ignores stale entries', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const cache = createAsyncSnapshotCache(1000, 32, 5000);
  assert.equal(cache.peek('missing'), undefined);
  let resolveLoad;
  const inflight = cache.get('repo', () => new Promise(resolve => { resolveLoad = resolve; }));
  assert.equal(cache.peek('repo'), inflight);
  await Promise.resolve();
  resolveLoad('v1');
  await inflight;
  assert.equal(await cache.peek('repo'), 'v1');
  now = 1001;
  assert.equal(cache.peek('repo'), undefined);
});

test('stale-while-revalidate serves stale value immediately, coalesces background refresh, and fences invalidation', async t => {
  let now = 0;
  let loads = 0;
  t.mock.method(Date, 'now', () => now);
  const cache = createAsyncSnapshotCache(1000, 32, 5000);
  const v1 = await cache.get('repo', async () => { loads++; return `v${loads}`; });
  assert.equal(v1, 'v1');
  assert.equal(loads, 1);

  now = 2000;
  let finishBg;
  const bgLoad = () => {
    loads++;
    return new Promise(resolve => { finishBg = resolve; });
  };
  const s1 = await cache.get('repo', bgLoad);
  const s2 = await cache.get('repo', bgLoad);
  assert.equal(s1, 'v1');
  assert.equal(s2, 'v1');
  assert.equal(loads, 2);

  finishBg('v2');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await cache.get('repo', async () => 'unexpected'), 'v2');

  now = 4000;
  let finishInvalidated;
  const staleRes = await cache.get('repo', () => new Promise(resolve => { finishInvalidated = resolve; }));
  assert.equal(staleRes, 'v2');
  cache.invalidate();
  finishInvalidated('late-v3');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await cache.get('repo', async () => 'fresh-v4'), 'fresh-v4');

  now = 6000;
  const failing = await cache.get('repo', async () => { throw new Error('bg fail'); });
  assert.equal(failing, 'fresh-v4');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await cache.get('repo', async () => 'recovered-v5'), 'fresh-v4');
});
