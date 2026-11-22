import { ClipboardItem, clipboard, type WebContents } from "electron";
import type { BrowserContact, BrowserTarget, BrowserToolsEvent } from "./contracts.js";

interface FindState {
  id: number;
  query: string;
}
export class BrowserPageTools {
  private readonly searches = new WeakMap<WebContents, FindState>();
  private activeSearch: WebContents | undefined;
  constructor(private readonly notify: (event: BrowserToolsEvent) => void) {}
  activeChanged(contents: WebContents | null | undefined) {
    const previous = this.activeSearch;
    if (!previous || previous === contents) return;
    if (!previous.isDestroyed()) previous.stopFindInPage("clearSelection");
    this.searches.delete(previous);
    this.activeSearch = undefined;
  }
  bind(contents: WebContents, target: BrowserTarget, current: () => boolean) {
    contents.on("found-in-page", (_event, result) => {
      const state = this.searches.get(contents);
      if (!state || result.requestId !== state.id || !current()) return;
      this.notify({
        kind: "find",
        target,
        query: state.query,
        requestId: state.id,
        active: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });
    contents.on("did-start-navigation", (_event, _url, inPage, mainFrame) => {
      if (mainFrame && !inPage) this.searches.delete(contents);
    });
  }
  find(contents: WebContents, query: string, direction?: "next" | "previous") {
    if (typeof query !== "string" || query.length > 1000) throw new Error("Invalid find query");
    this.activeChanged(contents);
    this.activeSearch = query ? contents : undefined;
    const same = this.searches.get(contents)?.query === query;
    if (!same || !query) {
      contents.stopFindInPage("clearSelection");
      this.searches.delete(contents);
    }
    if (!query) return 0;
    const id = contents.findInPage(query, { forward: direction !== "previous", findNext: !direction || !same });
    this.searches.set(contents, { id, query });
    return id;
  }
  async screenshot(contents: WebContents, current: () => boolean) {
    const image = await contents.capturePage();
    if (!current() || image.isEmpty()) throw new Error("网页已切换或无法截图");
    const png = new Blob([Uint8Array.from(image.toPNG())], { type: "image/png" });
    await clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
  print(contents: WebContents): Promise<void> {
    return new Promise((resolve, reject) =>
      contents.print({ silent: false }, (ok, reason) => {
        if (ok || /cancel/i.test(reason)) resolve();
        else reject(new Error(reason || "Printing failed"));
      }),
    );
  }
  async fill(contents: WebContents, contact: BrowserContact, current: () => boolean) {
    const origin = new URL(contents.getURL()).origin;
    if (!origin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))
      throw new Error("联系人仅可填入安全网页");
    const data = JSON.stringify({
      origin,
      name: contact.name,
      address: contact.address,
      email: contact.email,
      phone: contact.phone,
    });
    const result = await contents.executeJavaScriptInIsolatedWorld(
      1024,
      [
        {
          code: `(() => {
      const c = ${data};
      if (location.origin !== c.origin) return 0;
      const fields = Array.from(document.querySelectorAll('input,textarea')).filter(el => !el.disabled && !el.readOnly && el.getClientRects().length);
      const tokens = {name:c.name,email:c.email,tel:c.phone,'street-address':c.address,'address-line1':c.address};
      const type = el => el.autocomplete?.split(/\\s+/).at(-1) || (['email','tel'].includes(el.type) ? el.type : '');
      const eligible = fields.filter(el => Object.hasOwn(tokens, type(el)) && tokens[type(el)]);
      const forms = [...new Set(eligible.map(el => el.form))];
      const form = document.activeElement?.form || (forms.length === 1 ? forms[0] : undefined);
      if (form === undefined || form?.querySelector('input[type=password]')) return 0;
      let count = 0;
      for (const el of eligible.filter(el => el.form === form)) {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el,tokens[type(el)]);
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); count++;
      }
      return count;
    })()`,
        },
      ],
      true,
    );
    if (!current()) throw new Error("网页已切换");
    return Number(result) || 0;
  }
}
