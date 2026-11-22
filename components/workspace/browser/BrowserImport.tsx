"use client";

import { useEffect, useRef, useState } from "react";
import { AliIcon } from "@/components/AliIcon";
import type { ImportKind, ImportPreview, ImportSource } from "@/desktop/src/browser/contracts";
import { errorText, openBrowserSettings, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

import { BrowserImportSource, browserNames } from "./BrowserImportSource";

const lastSource = "piora-browser-import-source";
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
  const [sources, setSources] = useState<ImportSource[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [kinds, setKinds] = useState<ImportKind[]>(["passwords"]);
  const [previews, setPreviews] = useState<ImportPreview[]>([]),
    [sites, setSites] = useState<Record<string, string[]>>({});
  const [replace, setReplace] = useState(false),
    [busy, setBusy] = useState(false),
    [messages, setMessages] = useState<string[]>([]);
  const tokens = useRef(new Set<string>()),
    mounted = useRef(true);
  const selected = sources.find((row) => row.id === selectedId);
  const source = selected?.browser;
  const names = {
    passwords: copy("密码", "Passwords"),
    cookies: "Cookie",
    history: copy("浏览记录", "Browsing history"),
  };
  useEffect(() => {
    let live = true;
    void bridge
      .tools("importSources", null)
      .then((options) => {
        if (!live) return;
        let previous = "";
        try {
          previous = localStorage.getItem(lastSource) ?? "";
        } catch {
          /* storage is optional */
        }
        const first = options.find((row) => row.id === previous) ?? options[0];
        setSources(options);
        if (first) {
          setSelectedId(first.id);
          setKinds(first.browser === "piora" ? ["cookies"] : ["passwords"]);
        }
      })
      .catch((reason) => {
        if (live) setMessages([errorText(reason)]);
      });
    return () => {
      live = false;
    };
  }, [bridge]);
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
    if (!selected) return;
    reset();
    setBusy(true);
    const chosen: ImportPreview[] = [],
      picked: Record<string, string[]> = {},
      problems: string[] = [];
    for (const kind of kinds) {
      try {
        const result = await bridge.tools("importChoose", { kind, sourceId: selected.id });
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
  const selectedName = selected ? [browserNames[selected.browser], selected.name].filter(Boolean).join(" · ") : "";
  const description =
    source === "piora"
      ? copy("选择此 Windows 账户的 Piora 加密备份。", "Choose a Piora backup created with this Windows account.")
      : kinds.includes("history")
        ? copy(
            "浏览记录来自所选个人资料。如该浏览器正在使用资料，请先完全退出。",
            "Browsing history comes from the selected profile. Close the source browser if the profile is in use.",
          )
        : copy(
            "选择由" + selectedName + " 导出的密码 CSV 文件。",
            "Choose the password CSV exported from " + selectedName + ".",
          );
  return (
    <div className={styles.form}>
      <BrowserImportSource
        options={sources}
        current={selected}
        disabled={busy}
        select={(next) => {
          reset();
          setSelectedId(next.id);
          setKinds(next.browser === "piora" ? ["cookies"] : ["passwords"]);
          try {
            localStorage.setItem(lastSource, next.id);
          } catch {
            /* storage is optional */
          }
        }}
      />
      {selected && (
        <p className={styles.helper}>
          {description}{" "}
          {source === "piora" && (
            <button className={styles.textButton} type="button" onClick={openVault}>
              {copy("打开 Piora 密码管理器", "Open Piora password manager")}
            </button>
          )}
          {kinds.includes("passwords") && selected.directory && (
            <button
              className={styles.textButton}
              type="button"
              disabled={busy}
              onClick={() =>
                void bridge.tools("openImportSource", selected.id).catch((e) => setMessages([errorText(e)]))
              }
            >
              {copy("打开此资料的密码管理器", "Open this profile’s password manager")}
            </button>
          )}
        </p>
      )}
      <fieldset
        className={styles.options}
        disabled={busy || previews.length > 0}
        aria-label={copy("导入内容", "Data to import")}
      >
        {(["passwords", "cookies", "history", "extensions"] as const).map((kind) => {
          const unavailable =
            !selected ||
            kind === "extensions" ||
            (kind === "passwords" && source === "piora") ||
            (kind === "cookies" && source !== "piora") ||
            (kind === "history" && !selected?.directory);
          const title =
            kind === "extensions"
              ? copy("扩展程序", "Extensions")
              : kind === "passwords"
                ? copy("已保存的密码", "Saved passwords")
                : names[kind];
          const hint =
            kind === "passwords" && source === "piora"
              ? copy("在密码管理器中恢复凭据库备份", "Restore vault backups in the password manager")
              : kind === "cookies" && unavailable
                ? copy("可从 Piora 加密备份导入", "Available from a Piora encrypted backup")
                : kind === "extensions"
                  ? copy("当前版本暂不支持导入浏览器扩展", "Extension import is unavailable")
                  : kind === "history" && unavailable
                    ? copy("需要选择本机 Chrome 或 Edge 个人资料", "Choose a local Chrome or Edge profile")
                    : "";
          return (
            <label className={styles.option} key={kind} data-disabled={unavailable || undefined}>
              <AliIcon
                name={
                  kind === "passwords"
                    ? "key"
                    : kind === "cookies"
                      ? "cookie"
                      : kind === "history"
                        ? "history"
                        : "puzzle"
                }
                size={18}
              />
              <span>
                {title}
                {hint && <small>{hint}</small>}
              </span>
              <input
                className={styles.switch}
                type="checkbox"
                role="switch"
                aria-label={title}
                checked={kind !== "extensions" && kinds.includes(kind)}
                disabled={unavailable}
                onChange={(event) =>
                  kind !== "extensions" &&
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
      {previews.some((item) => item.kind !== "history") ? (
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
            disabled={busy || !selected || !kinds.length}
            type="button"
            onClick={() => void choose()}
          >
            {busy
              ? busyLabel
              : kinds.length === 1 && kinds[0] === "history"
                ? copy("预览导入", "Preview import")
                : copy("选择文件并预览", "Choose files and preview")}
          </button>
        )}
      </footer>
    </div>
  );
}
