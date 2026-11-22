"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportKind, ImportPreview } from "@/desktop/src/browser/contracts";
import { errorText, openBrowserSettings, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

type Source = "chrome" | "edge" | "piora";
export function ProfileImport({ bridge }: { bridge: ToolsBridge }) {
  const { copy } = useBrowserCopy();
  const [source, setSource] = useState<Source>("chrome"),
    [kinds, setKinds] = useState<ImportKind[]>(["passwords"]);
  const [previews, setPreviews] = useState<ImportPreview[]>([]),
    [sites, setSites] = useState<Record<string, string[]>>({});
  const [replace, setReplace] = useState(false),
    [busy, setBusy] = useState(false),
    [messages, setMessages] = useState<string[]>([]);
  const tokens = useRef(new Set<string>()),
    mounted = useRef(true);
  const names = { passwords: copy("密码", "Passwords"), cookies: "Cookie" };
  useEffect(() => {
    mounted.current = true;
    const outstanding = tokens.current;
    return () => {
      mounted.current = false;
      for (const token of outstanding) void bridge.tools("importCancel", token).catch(() => {});
      outstanding.clear();
    };
  }, [bridge]);
  const reset = () => {
    for (const token of tokens.current) void bridge.tools("importCancel", token).catch(() => {});
    tokens.current.clear();
    setPreviews([]);
    setSites({});
    setReplace(false);
    setMessages([]);
  };
  const choose = async () => {
    reset();
    setBusy(true);
    const chosen: ImportPreview[] = [],
      picked: Record<string, string[]> = {},
      problems: string[] = [];
    for (const kind of kinds) {
      try {
        const result = await bridge.tools("importChoose", kind);
        if (!mounted.current) {
          if (result) await bridge.tools("importCancel", result.token);
          break;
        }
        if (result) {
          chosen.push(result);
          tokens.current.add(result.token);
          picked[result.token] = result.sites;
        } else problems.push(names[kind] + " · " + copy("已取消", "Cancelled"));
      } catch (error) {
        problems.push(names[kind] + " · " + errorText(error));
      }
    }
    if (mounted.current) {
      setPreviews(chosen);
      setSites(picked);
      setMessages(problems);
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    const result = [...messages];
    for (const entry of previews) {
      try {
        const selected = sites[entry.token] ?? [];
        if (!selected.length) {
          await bridge.tools("importCancel", entry.token);
          result.push(names[entry.kind] + " · " + copy("已跳过", "Skipped"));
          continue;
        }
        const stats = await bridge.tools("importApply", { token: entry.token, replace, sites: selected });
        result.push(
          names[entry.kind] +
            " · " +
            [
              copy("已导入", "Imported") + " " + stats.added,
              copy("已跳过", "Skipped") + " " + stats.skipped,
              copy("失败", "Failed") + " " + stats.failed,
            ].join(" / "),
        );
      } catch (error) {
        result.push(names[entry.kind] + " · " + errorText(error));
      } finally {
        tokens.current.delete(entry.token);
      }
    }
    if (mounted.current) {
      setPreviews([]);
      setSites({});
      setMessages(result);
      setBusy(false);
    }
  };
  return (
    <div className={styles.form}>
      <label>
        {copy("来源", "Source")}
        <select
          value={source}
          disabled={busy}
          onChange={(event) => {
            reset();
            const next = event.target.value as Source;
            setSource(next);
            setKinds(next === "piora" ? ["cookies"] : ["passwords"]);
          }}
        >
          <option value="chrome">Google Chrome</option>
          <option value="edge">Microsoft Edge</option>
          <option value="piora">Piora</option>
        </select>
      </label>
      <fieldset disabled={busy || previews.length > 0}>
        {(["passwords", "cookies"] as const).map((kind) => (
          <label className={styles.check} key={kind}>
            <input
              type="checkbox"
              checked={kinds.includes(kind)}
              disabled={kind === "cookies" && source !== "piora"}
              onChange={(event) =>
                setKinds((current) =>
                  event.target.checked ? [...current, kind] : current.filter((k) => k !== kind),
                )
              }
            />
            {names[kind]}
          </label>
        ))}
      </fieldset>
      <p>
        {source === "piora"
          ? copy(
              "可选择同一系统账户的 Piora 加密会话备份。密码可从导出文件导入，凭据库加密备份在密码管理器中恢复。",
              "Choose a Piora session backup from this OS account. Password files can be imported here. Restore encrypted vault backups in Password manager.",
            )
          : copy(
              "选择你从来源浏览器正式导出的密码 CSV 文件。此来源的网站登录可在 Piora 内完成。",
              "Choose a password CSV exported by this browser. Sign in to websites inside Piora for this source.",
            )}
      </p>
      <button type="button" disabled={busy} onClick={() => openBrowserSettings("vault")}>
        {copy("打开密码管理器", "Open password manager")}
      </button>
      {previews.map((entry) => (
        <fieldset key={entry.token} disabled={busy}>
          <legend>
            {names[entry.kind]} · {entry.filename}
          </legend>
          <small>
            {copy("有效", "Valid")} {entry.valid} · {copy("重复", "Duplicates")} {entry.duplicates} ·{" "}
            {copy("跳过", "Skipped")} {entry.skipped}
          </small>
          {entry.sites.map((site) => (
            <label className={styles.check} key={site}>
              <input
                type="checkbox"
                checked={(sites[entry.token] ?? []).includes(site)}
                onChange={(event) =>
                  setSites((current) => ({
                    ...current,
                    [entry.token]: event.target.checked
                      ? [...(current[entry.token] ?? []), site]
                      : (current[entry.token] ?? []).filter((x) => x !== site),
                  }))
                }
              />
              {site}
            </label>
          ))}
        </fieldset>
      ))}
      {previews.length > 0 ? (
        <>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={replace}
              disabled={busy}
              onChange={(event) => setReplace(event.target.checked)}
            />
            {copy("替换重复项目", "Replace existing entries")}
          </label>
          {replace && (
            <small>
              {copy(
                "同一站点有多个同名账户时，优先匹配已保存的登录地址。无法确定的条目将跳过。",
                "For accounts sharing a site and username, the saved sign-in URL takes priority. Ambiguous entries are skipped.",
              )}
            </small>
          )}
          <div className={styles.actions}>
            <button
              disabled={busy || !Object.values(sites).some((selected) => selected.length)}
              type="button"
              onClick={() => void apply()}
            >
              {copy("确认导入", "Confirm import")}
            </button>
            <button disabled={busy} type="button" onClick={reset}>
              {copy("取消", "Cancel")}
            </button>
          </div>
        </>
      ) : (
        <button disabled={busy || !kinds.length} type="button" onClick={() => void choose()}>
          {copy("选择文件并预览", "Choose files and preview")}
        </button>
      )}
      {messages.length > 0 && (
        <ul role="status">
          {messages.map((value, i) => (
            <li key={i}>{value}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
