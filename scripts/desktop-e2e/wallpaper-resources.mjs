import assert from "node:assert/strict";

// Runs inside the renderer during the hot-switch test only.
export function installWallpaperResourceProbe() {
  const prototype = WebGLRenderingContext.prototype;
  const create = prototype.createTexture, remove = prototype.deleteTexture;
  const drawArrays = prototype.drawArrays, drawElements = prototype.drawElements;
  const contexts = new Map();
  let observer, restoreFocus;
  prototype.createTexture = function () {
    const texture = create.call(this);
    const id = this.canvas.dataset?.characterBackground;
    if (texture && id) {
      if (!contexts.has(this)) contexts.set(this, { id, textures: new Set(), removed: new Set(), drawCalls: 0 });
      contexts.get(this).textures.add(texture);
    }
    return texture;
  };
  prototype.deleteTexture = function (texture) {
    remove.call(this, texture);
    const record = contexts.get(this);
    if (record?.textures.has(texture)) record.removed.add(texture);
  };
  prototype.drawArrays = function (...args) {
    const record = contexts.get(this);
    if (record) record.drawCalls++;
    return drawArrays.apply(this, args);
  };
  prototype.drawElements = function (...args) {
    const record = contexts.get(this);
    if (record) record.drawCalls++;
    return drawElements.apply(this, args);
  };
  window.__pioraWallpaperProbe = {
    snapshot() {
      return [...contexts].map(([gl, record]) => {
        const active = gl.canvas.isConnected;
        return {
          id: record.id, connected: active, lost: gl.isContextLost(),
          created: record.textures.size, deleted: record.removed.size,
          live: [...record.textures].filter(texture => gl.isTexture(texture)).length,
          drawCalls: record.drawCalls,
          position: active ? getComputedStyle(document.body, "::before").backgroundPosition : null,
        };
      });
    },
    ready(id) {
      const history = this.snapshot(), current = history.at(-1);
      return current?.id === id && current.connected && current.live === current.created
        && history.slice(0, -1).every(old => old.lost && old.deleted === old.created && old.live === 0);
    },
    freezeWhenReady(id) {
      const selector = `body > canvas[data-character-background="${id}"][data-ready="true"]`;
      observer = new MutationObserver(() => {
        if (!document.querySelector(selector)) return;
        observer.disconnect();
        const previous = Object.getOwnPropertyDescriptor(document, "hasFocus");
        Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
        restoreFocus = () => {
          if (previous) Object.defineProperty(document, "hasFocus", previous);
          else Reflect.deleteProperty(document, "hasFocus");
          window.dispatchEvent(new Event("focus"));
        };
        window.dispatchEvent(new Event("blur"));
      });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-ready"] });
    },
    isFrozen() { return Boolean(restoreFocus); },
    resume() {
      observer?.disconnect();
      restoreFocus?.();
      observer = restoreFocus = undefined;
    },
    restore() {
      this.resume();
      prototype.createTexture = create;
      prototype.deleteTexture = remove;
      prototype.drawArrays = drawArrays;
      prototype.drawElements = drawElements;
      contexts.clear();
      delete window.__pioraWallpaperProbe;
    },
  };
}

export async function verifyWallpaperPause(page) {
  const results = [];
  for (const event of ["blur", "visibilitychange"]) {
    await page.waitForFunction(() => window.__pioraPuppetDebug?.snapshot().running);
    const check = await page.evaluate(async event => {
      const property = event === "blur" ? "hasFocus" : "hidden";
      const target = event === "blur" ? window : document;
      const previous = Object.getOwnPropertyDescriptor(document, property);
      Object.defineProperty(document, property, { configurable: true, value: event === "blur" ? () => false : true });
      try {
        target.dispatchEvent(new Event(event));
        const paused = window.__pioraPuppetDebug.snapshot();
        await new Promise(resolve => setTimeout(resolve, 250));
        const later = window.__pioraPuppetDebug.snapshot();
        return { event, source: "controlled DOM event", paused: !paused.running && !later.running,
          frames: [paused.framesDrawn, later.framesDrawn] };
      } finally {
        if (previous) Object.defineProperty(document, property, previous);
        else Reflect.deleteProperty(document, property);
        target.dispatchEvent(new Event(event === "blur" ? "focus" : event));
      }
    }, event);
    assert.ok(check.paused);
    assert.equal(check.frames[0], check.frames[1]);
    await page.waitForFunction(count => window.__pioraPuppetDebug?.snapshot().framesDrawn > count, check.frames[1]);
    results.push({ ...check, resumed: true });
  }
  return results;
}
