// fs-retry.cjs v2 — retry fs rename/unlink/rm on EBUSY/EPERM/ENOTEMPTY
// + copy-fallback for directory renames (F: drive doesn't support atomic dir rename)
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars */
const fs = require("fs");

const MAX = 60;      // max attempts
const DELAY = 500;   // ms between attempts (30s total)

// Save originals BEFORE any wrapping
const _renameSync = fs.renameSync.bind(fs);
const _unlinkSync = fs.unlinkSync.bind(fs);
const _rmSync = fs.rmSync ? fs.rmSync.bind(fs) : null;
const _rmdirSync = fs.rmdirSync.bind(fs);
const _cpSync = fs.cpSync ? fs.cpSync.bind(fs) : null;
const _statSync = fs.statSync.bind(fs);

const _prename = fs.promises.rename.bind(fs.promises);
const _punlink = fs.promises.unlink.bind(fs.promises);
const _prm = fs.promises.rm ? fs.promises.rm.bind(fs.promises) : null;
const _prmdir = fs.promises.rmdir.bind(fs.promises);
const _pcp = fs.promises.cp ? fs.promises.cp.bind(fs.promises) : null;

function isLockErr(e) {
  return e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "ENOTEMPTY");
}

const _sab = (typeof SharedArrayBuffer !== "undefined") ? new SharedArrayBuffer(4) : null;
const _ia = _sab ? new Int32Array(_sab) : null;
function sleepSync(ms) {
  if (_ia) { try { Atomics.wait(_ia, 0, 0, ms); return; } catch (_) {} }
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

function isDir(p) {
  try { return _statSync(p).isDirectory(); } catch (_) { return false; }
}

// ── SYNC rename with copy-fallback ──
fs.renameSync = function (src, dst) {
  let lastErr;
  for (let i = 0; i < MAX; i++) {
    try { return _renameSync(src, dst); }
    catch (e) {
      lastErr = e;
      if (!isLockErr(e)) throw e;
      if (i === 0) console.error("[fs-retry] renameSync retry: " + src + " -> " + dst);
      sleepSync(DELAY);
    }
  }
  if (isDir(src) && _cpSync) {
    console.error("[fs-retry] renameSync exhausted " + MAX + " retries, trying copy-fallback");
    _cpSync(src, dst, { recursive: true, force: true });
    console.error("[fs-retry] copy OK, removing source...");
    try { if (_rmSync) _rmSync(src, { recursive: true, force: true }); } catch (_) {}
    return;
  }
  throw lastErr;
};

fs.unlinkSync = function (...a) {
  let lastErr;
  for (let i = 0; i < MAX; i++) {
    try { return _unlinkSync(...a); }
    catch (e) { lastErr = e; if (!isLockErr(e)) throw e; sleepSync(DELAY); }
  }
  throw lastErr;
};

if (_rmSync) fs.rmSync = function (...a) {
  let lastErr;
  for (let i = 0; i < MAX; i++) {
    try { return _rmSync(...a); }
    catch (e) { lastErr = e; if (!isLockErr(e)) throw e; sleepSync(DELAY); }
  }
  throw lastErr;
};

fs.rmdirSync = function (...a) {
  let lastErr;
  for (let i = 0; i < MAX; i++) {
    try { return _rmdirSync(...a); }
    catch (e) { lastErr = e; if (!isLockErr(e)) throw e; sleepSync(DELAY); }
  }
  throw lastErr;
};

// ── PROMISES rename with copy-fallback ──
const p = fs.promises;
if (p) {
  p.rename = async function (src, dst) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try { return await _prename(src, dst); }
      catch (e) {
        lastErr = e;
        if (!isLockErr(e)) throw e;
        if (i === 0) console.error("[fs-retry] promises.rename retry: " + src + " -> " + dst);
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
    if (isDir(src) && _pcp) {
      console.error("[fs-retry] promises.rename exhausted " + MAX + " retries, trying copy-fallback");
      await _pcp(src, dst, { recursive: true, force: true });
      console.error("[fs-retry] copy OK, removing source...");
      try { if (_prm) await _prm(src, { recursive: true, force: true }); } catch (_) {}
      return;
    }
    throw lastErr;
  };

  p.unlink = async function (...a) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try { return await _punlink(...a); }
      catch (e) { lastErr = e; if (!isLockErr(e)) throw e; await new Promise(r => setTimeout(r, DELAY)); }
    }
    throw lastErr;
  };

  if (_prm) p.rm = async function (...a) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try { return await _prm(...a); }
      catch (e) { lastErr = e; if (!isLockErr(e)) throw e; await new Promise(r => setTimeout(r, DELAY)); }
    }
    throw lastErr;
  };

  if (_prmdir) p.rmdir = async function (...a) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try { return await _prmdir(...a); }
      catch (e) { lastErr = e; if (!isLockErr(e)) throw e; await new Promise(r => setTimeout(r, DELAY)); }
    }
    throw lastErr;
  };
}

console.error("[fs-retry] v2 installed (MAX=" + MAX + " DELAY=" + DELAY + "ms copy-fallback=ON)");
