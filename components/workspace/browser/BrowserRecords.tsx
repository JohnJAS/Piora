"use client";

import { AliIcon } from "@/components/AliIcon";
import { useEffect, useState } from "react";
import type { Transfer, TransferAction, Visit } from "@/desktop/src/browser/contracts";
import { errorText, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

export function BrowserRecords({
  bridge,
  kind,
  recent = false,
  navigate,
  expand,
}: {
  bridge: ToolsBridge;
  kind: "history" | "downloads";
  recent?: boolean;
  navigate(url: string): void;
  expand?(): void;
}) {
  const { copy, locale } = useBrowserCopy();
  const [day, setDay] = useState("");
  const [text, setText] = useState(""),
    [cursors, setCursors] = useState<number[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]),
    [downloads, setDownloads] = useState<Transfer[]>([]);
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pageSize = recent ? 5 : 25;
  const before = cursors.at(-1);
  useEffect(
    () =>
      bridge.onToolsEvent?.((event) => {
        if (event.kind === "library" && event.section === kind) setRevision((value) => value + 1);
      }),
    [bridge, kind],
  );
  useEffect(() => {
    let current = true;
    const midnight = day && kind === "history" ? new Date(day + "T00:00:00") : null;
    const tomorrow = midnight ? new Date(midnight) : null;
    tomorrow?.setDate(tomorrow.getDate() + 1);
    const query = {
      text,
      before,
      limit: pageSize + 1,
      ...(midnight && tomorrow ? { since: midnight.getTime(), until: tomorrow.getTime() - 1 } : {}),
    };
    setBusy(true);
    const request =
      kind === "history"
        ? bridge.tools("history", query).then((rows) => {
            if (current) setVisits(rows);
          })
        : bridge.tools("downloads", query).then((rows) => {
            if (current) setDownloads(rows);
          });
    void request
      .catch((reason) => {
        if (current) setError(errorText(reason));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [before, bridge, day, kind, pageSize, revision, text]);
  const act = async (request: Promise<unknown>) => {
    try {
      await request;
      setError("");
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const rows = kind === "history" ? visits : downloads;
  const date = (at: number) => new Date(at).toLocaleDateString(locale);
  const time = (at: number) => new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const stateLabel = {
    progressing: copy("进行中", "Downloading"),
    paused: copy("已暂停", "Paused"),
    completed: copy("已完成", "Complete"),
    cancelled: copy("已取消", "Cancelled"),
    interrupted: copy("已中断", "Interrupted"),
  };
  const actionLabel: Record<TransferAction, string> = {
    pause: copy("暂停", "Pause"),
    resume: copy("继续", "Resume"),
    cancel: copy("取消", "Cancel"),
    open: copy("打开", "Open"),
    reveal: copy("在文件夹中显示", "Show in folder"),
    remove: copy("移除记录", "Remove record"),
  };
  return (
    <div className={styles.records} data-browser-records={recent ? "recent" : kind}>
      {!recent && (
        <div className={styles.searchLine}>
          <label>
            <AliIcon name="search" size={16} />
            <input
              type="search"
              aria-label={copy("搜索记录", "Search records")}
              placeholder={copy("搜索记录", "Search records")}
              value={text}
              onChange={(event) => {
                setCursors([]);
                setText(event.target.value);
              }}
            />
          </label>
          {kind === "history" && (
            <label className={styles.actions}>
              {copy("访问日期", "Date visited")}
              <input
                type="date"
                value={day}
                onChange={(event) => {
                  setCursors([]);
                  setDay(event.target.value);
                }}
              />
            </label>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!busy && !rows.length && (
        <div className={styles.empty}>
          <AliIcon name={kind === "history" ? "history" : "download"} size={23} />
          <p>
            {text || day
              ? copy("没有匹配的记录", "No matching records")
              : kind === "history"
                ? copy("暂无浏览记录", "No browsing history yet")
                : copy("暂无下载记录", "No downloads yet")}
          </p>
        </div>
      )}
      {kind === "history"
        ? visits.slice(0, pageSize).map((row, index) => (
            <div key={row.id}>
              {(index === 0 || date(visits[index - 1]!.visited) !== date(row.visited)) && (
                <h4>{date(row.visited)}</h4>
              )}
              <div className={styles.record} data-visit-id={row.id}>
                <AliIcon name="earth" size={16} />
                <button className={styles.link} type="button" title={row.url} onClick={() => navigate(row.url)}>
                  <strong>{row.title || row.url}</strong>
                  <small>
                    {time(row.visited)} · {row.url}
                  </small>
                </button>
                <button
                  type="button"
                  aria-label={copy("删除访问记录", "Delete visit")}
                  onClick={() => void act(bridge.tools("deleteVisit", row.id))}
                >
                  <AliIcon name="close" size={14} />
                </button>
              </div>
            </div>
          ))
        : downloads.slice(0, pageSize).map((row) => {
            const actions: TransferAction[] = [];
            if (row.live) {
              if (row.state === "progressing") actions.push("pause");
              if (row.resumable && (row.state === "paused" || row.state === "interrupted")) actions.push("resume");
              actions.push("cancel");
            } else {
              if (row.state === "completed" && !row.missing) actions.push("open", "reveal");
              actions.push("remove");
            }
            return (
              <article className={styles.download} key={row.id} data-transfer-state={row.state}>
                <AliIcon name="file" size={19} />
                <div className={styles.downloadCopy}>
                  <strong>{row.filename}</strong>
                  <small title={row.path}>
                    {date(row.started)} ·{" "}
                    {row.missing ? copy("文件已移动或删除", "File moved or deleted") : stateLabel[row.state]}
                    {row.live &&
                      " · " +
                        (row.total > 0
                          ? Math.floor((row.received * 100) / row.total) + "%"
                          : row.received.toLocaleString(locale) + " B")}
                  </small>
                  {row.live && <progress max={row.total || 1} value={row.total > 0 ? row.received : undefined} />}
                </div>
                <div className={styles.actions}>
                  {actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => void act(bridge.tools("transfer", { id: row.id, action }))}
                    >
                      {actionLabel[action]}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
      {recent ? (
        <button type="button" onClick={expand}>
          {copy("查看全部下载", "See all downloads")}
        </button>
      ) : (
        (cursors.length > 0 || rows.length > pageSize) && (
          <nav className={styles.actions}>
            <button
              type="button"
              disabled={!cursors.length}
              onClick={() => setCursors((stack) => stack.slice(0, -1))}
            >
              {copy("上一页", "Previous")}
            </button>
            <button
              type="button"
              disabled={rows.length <= pageSize}
              onClick={() => setCursors((stack) => [...stack, rows[pageSize - 1]!.id])}
            >
              {copy("下一页", "Next")}
            </button>
          </nav>
        )
      )}
    </div>
  );
}
