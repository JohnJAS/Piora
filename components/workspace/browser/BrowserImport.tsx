"use client";

import { useEffect, useRef, useState } from "react";
import { AliIcon } from "@/components/AliIcon";
import type { ImportKind, ImportPreview } from "@/desktop/src/browser/contracts";
import { errorText, openBrowserSettings, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

type Source = "chrome" | "edge" | "piora";
export function ProfileImport({
  bridge,
  cancel,
  openVault = () => openBrowserSettings("vault"),
}: {
  bridge: ToolsBridge;
  cancel(): void;
  openVault?(): void;
}) {
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
  const busyLabel = copy("处理中…", "Working…");
  const description =
    source === "piora"
      ? copy(
          "可恢复此 Windows 账户下的 Piora 加密会话备份。",
          "Restore a Piora session backup created with this Windows account.",
        )
      : copy(
          "从 " +
            (source === "chrome" ? "Google Chrome" : "Microsoft Edge") +
            " 导出的密码 CSV 文件中选择要导入的站点。",
          "Choose sites from a password CSV exported by the selected browser.",
        );
  return (
    <div className={styles.form}>
      <label className={styles.sourceLine}>
        <span>{copy("从", "From")}</span>
        <span className={styles.sourceSelect}>
          {source === "chrome" ? (
            <i className={styles.chromeMark} aria-hidden="true" />
          ) : (
            <AliIcon name={source === "piora" ? "desktop" : "earth"} size={17} />
          )}
          <select
            aria-label={copy("来源浏览器", "Source browser")}
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
          <AliIcon name="chevron-down" size={14} />
        </span>
      </label>
      <p className={styles.helper}>{description}</p>
      <fieldset
        className={styles.options}
        disabled={busy || previews.length > 0}
        aria-label={copy("导入内容", "Data to import")}
      >
        {(["passwords", "cookies"] as const).map((kind) => {
          const unavailable = kind === "cookies" && source !== "piora";
          return (
            <label className={styles.option} key={kind} data-disabled={unavailable || undefined}>
              <AliIcon name={kind === "passwords" ? "key" : "cookie"} size={18} />
              <span>
                {kind === "passwords" ? copy("已保存的密码", "Saved passwords") : "Cookie"}
                {unavailable && (
                  <small>{copy("可从 Piora 加密备份导入", "Available from a Piora encrypted backup")}</small>
                )}
              </span>
              <input
                className={styles.switch}
                type="checkbox"
                role="switch"
                aria-label={names[kind]}
                checked={kinds.includes(kind)}
                disabled={unavailable}
                onChange={(event) =>
                  setKinds((current) =>
                    event.target.checked ? [...current, kind] : current.filter((item) => item !== kind),
                  )
                }
              />
            </label>
          );
        })}
      </fieldset>
      {previews.map((entry) => (
        <fieldset key={entry.token} disabled={busy} className={styles.previewBox}>
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
                      : (current[entry.token] ?? []).filter((item) => item !== site),
                  }))
                }
              />
              {site}
            </label>
          ))}
        </fieldset>
      ))}
      {previews.length ? (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={replace}
            disabled={busy}
            onChange={(event) => setReplace(event.target.checked)}
          />
          {copy("替换重复项目", "Replace existing entries")}
        </label>
      ) : null}
      {replace && (
        <p className={styles.helper}>
          {copy(
            "同名账户按登录地址匹配，无法区分的条目会跳过。",
            "Accounts are matched by sign-in address. Ambiguous matches are skipped.",
          )}
        </p>
      )}
      {!previews.length && kinds.includes("passwords") && (
        <div className={styles.note}>
          <AliIcon name="lock" size={16} />
          <div>
            <strong>{copy("密码保存到本机凭据库", "Passwords are saved in your local vault")}</strong>
            <p>
              {copy("导入密码前，请先解锁凭据库。", "Unlock the vault before importing passwords.")}{" "}
              <button className={styles.textButton} type="button" disabled={busy} onClick={openVault}>
                {copy("打开密码管理器", "Open password manager")}
              </button>
            </p>
          </div>
        </div>
      )}
      {messages.length > 0 && (
        <ul className={styles.feedback} role="status">
          {messages.map((value, i) => (
            <li key={i}>{value}</li>
          ))}
        </ul>
      )}
      <footer className={styles.footer}>
        <button className={styles.secondary} type="button" disabled={busy} onClick={cancel}>
          {copy("取消", "Cancel")}
        </button>
        {previews.length ? (
          <button
            className={styles.primary}
            disabled={busy || !Object.values(sites).some((selected) => selected.length)}
            type="button"
            onClick={() => void apply()}
          >
            {busy ? busyLabel : copy("确认导入", "Confirm import")}
          </button>
        ) : (
          <button
            className={styles.primary}
            disabled={busy || !kinds.length}
            type="button"
            onClick={() => void choose()}
          >
            {busy ? busyLabel : copy("选择文件并预览", "Choose files and preview")}
          </button>
        )}
      </footer>
    </div>
  );
}
