// fs-retry.cjs — retry fs rename/unlink/rm on EBUSY/EPERM/ENOTEMPTY
// to survive Windows real-time scanner locks during electron-builder.
const fs = require("fs");

const MAX = 80;      // max attempts
const DELAY = 200;   // ms between attempts

function isLockErr(e) {
  return e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "ENOTEMPTY");
}

// true sync sleep without CPU spin (requires SharedArrayBuffer)
const _sab = (typeof SharedArrayBuffer !== "undefined") ? new SharedArrayBuffer(4) : null;
const _ia = _sab ? new Int32Array(_sab) : null;
function sleepSync(ms) {
  if (_ia) {
    try { Atomics.wait(_ia, 0, 0, ms); return; } catch (_) {}
  }
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin fallback */ }
}

function wrapSync(fn) {
  return function (...args) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try {
        return fn.apply(this, args);
      } catch (e) {
        lastErr = e;
        if (!isLockErr(e)) throw e;
        sleepSync(DELAY);
      }
    }
    throw lastErr;
  };
}

function wrapPromise(fn) {
  return async function (...args) {
    let lastErr;
    for (let i = 0; i < MAX; i++) {
      try {
        return await fn.apply(this, args);
      } catch (e) {
        lastErr = e;
        if (!isLockErr(e)) throw e;
        await new Promise((r) => setTimeout(r, DELAY));
      }
    }
    throw lastErr;
  };
}

// sync wrappers
fs.renameSync = wrapSync(fs.renameSync);
fs.unlinkSync = wrapSync(fs.unlinkSync);
if (typeof fs.rmSync === "function") fs.rmSync = wrapSync(fs.rmSync);
fs.rmdirSync = wrapSync(fs.rmdirSync);

// promises wrappers
const p = fs.promises;
if (p) {
  p.rename = wrapPromise(p.rename);
  p.unlink = wrapPromise(p.unlink);
  if (typeof p.rm === "function") p.rm = wrapPromise(p.rm);
  if (typeof p.rmdir === "function") p.rmdir = wrapPromise(p.rmdir);
}

console.log("[fs-retry] installed (MAX=" + MAX + " DELAY=" + DELAY + "ms)");
