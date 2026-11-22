"use client";

import { useEffect, useState } from "react";
import type { BrowserContact, BrowserTarget, ContactFields } from "@/desktop/src/browser/contracts";
import { errorText, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

const empty: ContactFields = { name: "", address: "", email: "", phone: "" };
export function ContactBook({ bridge, target }: { bridge: ToolsBridge; target?: BrowserTarget }) {
  const { copy } = useBrowserCopy();
  const [rows, setRows] = useState<BrowserContact[]>([]),
    [entry, setEntry] = useState<(ContactFields & { id?: string }) | null>(null);
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  useEffect(
    () =>
      bridge.onToolsEvent?.((event) => {
        if (event.kind === "library" && event.section === "contacts") setRevision((x) => x + 1);
      }),
    [bridge],
  );
  useEffect(() => {
    let current = true;
    void bridge
      .tools("contacts", null)
      .then((result) => {
        if (current) setRows(result);
      })
      .catch((error) => {
        if (current) setMessage(errorText(error));
      });
    return () => {
      current = false;
    };
  }, [bridge, revision]);
  const labels: Record<keyof ContactFields, string> = {
    name: copy("姓名", "Name"),
    address: copy("地址", "Address"),
    email: copy("邮箱", "Email"),
    phone: copy("电话", "Phone"),
  };
  const run = async (operation: Promise<unknown>, success?: () => void) => {
    try {
      await operation;
      setMessage("");
      success?.();
      setRevision((x) => x + 1);
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  return (
    <div className={styles.records}>
      {rows.map((row) => (
        <article className={styles.download} key={row.id}>
          <strong>{row.name}</strong>
          <small>{[row.address, row.phone, row.email].filter(Boolean).join(" · ")}</small>
          <div className={styles.actions}>
            {target && (
              <button
                type="button"
                onClick={() => {
                  void bridge
                    .tools("fillContact", { target, id: row.id })
                    .then((count) =>
                      setMessage(
                        count
                          ? copy("已填写字段数", "Fields filled") + " " + count
                          : copy("当前网页没有明确匹配的表单", "No matching form on this page"),
                      ),
                    )
                    .catch((error) => setMessage(errorText(error)));
                }}
              >
                {copy("填入当前网页", "Fill current page")}
              </button>
            )}
            <button type="button" onClick={() => setEntry(row)}>
              {copy("编辑", "Edit")}
            </button>
            <button type="button" onClick={() => void run(bridge.tools("deleteContact", row.id))}>
              {copy("删除", "Delete")}
            </button>
          </div>
        </article>
      ))}
      {entry ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void run(bridge.tools("saveContact", entry), () => setEntry(null));
          }}
        >
          {(Object.keys(empty) as (keyof ContactFields)[]).map((key) => (
            <label key={key}>
              {labels[key]}
              <input
                required={key === "name"}
                type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                value={entry[key]}
                onChange={(event) => setEntry({ ...entry, [key]: event.target.value })}
              />
            </label>
          ))}
          <div className={styles.actions}>
            <button type="submit">{copy("保存联系人", "Save contact")}</button>
            <button type="button" onClick={() => setEntry(null)}>
              {copy("取消", "Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setEntry({ ...empty })}>
          {copy("新增联系人", "Add contact")}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
