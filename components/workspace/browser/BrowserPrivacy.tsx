"use client";

import { useState } from "react";
import type { ClearCategory, ClearPreview, ClearRange } from "@/desktop/src/browser/contracts";
import { errorText, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

export function PrivacyControls({ bridge }: { bridge: ToolsBridge }) {
  const { copy } = useBrowserCopy();
  const labels: Record<ClearCategory, string> = {
    history: copy("浏览历史", "Browsing history"),
    downloads: copy("下载记录", "Download history"),
    sites: copy("Cookie 和站点数据", "Cookies and site data"),
    cache: copy("缓存", "Cached files"),
    contacts: copy("表单资料（联系人）", "Form data (contacts)"),
    permissions: copy("站点权限", "Site permissions"),
  };
  const ranges: Record<ClearRange, string> = {
    hour: copy("最近一小时", "Last hour"),
    day: copy("最近一天", "Last day"),
    week: copy("最近一周", "Last week"),
    month: copy("最近四周", "Last four weeks"),
    all: copy("全部时间", "All time"),
  };
  const [categories, setCategories] = useState<ClearCategory[]>(["history"]),
    [range, setRange] = useState<ClearRange>("hour");
  const [preview, setPreview] = useState<ClearPreview | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const allOnly = categories.includes("sites") || categories.includes("cache");
  const incompatible = allOnly && range !== "all";
  const inspect = async () => {
    setBusy(true);
    setMessage("");
    try {
      setPreview(await bridge.tools("clearPreview", { categories, range }));
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await bridge.tools("clearApply", preview.token);
      setMessage(
        [
          result.done.length &&
            copy("已清除", "Cleared") + " · " + result.done.map((key) => labels[key]).join("、"),
          result.failed.length &&
            copy("需要重试", "Retry required") + " · " + result.failed.map((key) => labels[key]).join("、"),
        ]
          .filter(Boolean)
          .join(" / "),
      );
      if (result.failed.length) setCategories(result.failed);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
      setPreview(null);
    }
  };
  return (
    <div className={styles.form}>
      <fieldset disabled={busy}>
        {(Object.keys(labels) as ClearCategory[]).map((key) => (
          <label className={styles.check} key={key}>
            <input
              type="checkbox"
              checked={categories.includes(key)}
              onChange={(event) => {
                setCategories((current) =>
                  event.target.checked ? [...current, key] : current.filter((value) => value !== key),
                );
                setPreview(null);
                setMessage("");
              }}
            />
            {labels[key]}
          </label>
        ))}
      </fieldset>
      <label>
        {copy("时间范围", "Time range")}
        <select
          value={range}
          disabled={busy}
          onChange={(event) => {
            setRange(event.target.value as ClearRange);
            setPreview(null);
            setMessage("");
          }}
        >
          {Object.entries(ranges).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {allOnly && (
        <p>
          {copy(
            "Cookie、站点数据和缓存仅支持全部时间。可单独清理其他类别。",
            "Cookies, site data and cached files support all time. Other categories can be cleared separately.",
          )}
        </p>
      )}
      {categories.includes("sites") && (
        <p>
          {copy(
            "清理站点数据会退出此浏览器内的网站账户。",
            "Clearing site data signs you out of websites in this browser.",
          )}
        </p>
      )}
      {categories.includes("downloads") && (
        <p>{copy("下载的文件保留在磁盘。", "Downloaded files stay on disk.")}</p>
      )}
      {preview ? (
        <>
          <ul>
            {categories.map((key) => (
              <li key={key}>
                {labels[key]} · {preview.counts[key]}{" "}
                {key === "cache" ? "B" : key === "sites" ? copy("个有 Cookie 的域名", "domains with cookies") : ""}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button disabled={busy} type="button" onClick={() => void clear()}>
              {copy("确认清除", "Confirm clear")}
            </button>
            <button disabled={busy} type="button" onClick={() => setPreview(null)}>
              {copy("取消", "Cancel")}
            </button>
          </div>
        </>
      ) : (
        <button disabled={busy || !categories.length || incompatible} type="button" onClick={() => void inspect()}>
          {copy("预览清理范围", "Preview data to clear")}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
