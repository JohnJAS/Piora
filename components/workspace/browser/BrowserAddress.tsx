"use client";

import { useEffect, useId, useState, type RefObject } from "react";
import { AliIcon } from "@/components/AliIcon";
import { createPortal } from "react-dom";
import type { BrowserToolInvoke, Visit } from "@/desktop/src/browser/contracts";
import styles from "./BrowserTools.module.css";

export function BrowserAddress({
  value,
  change,
  inputRef,
  placeholder,
  label,
  invoke,
  slot,
  navigate,
}: {
  value: string;
  change(value: string): void;
  inputRef: RefObject<HTMLInputElement | null>;
  placeholder: string;
  label: string;
  invoke?: BrowserToolInvoke;
  slot: HTMLElement | null;
  navigate(value: string): void;
}) {
  const listId = useId(),
    [editing, setEditing] = useState(false),
    [focus, setFocus] = useState(false),
    [rows, setRows] = useState<Visit[]>([]),
    [selected, setSelected] = useState(-1);
  useEffect(() => {
    let current = true;
    if (!invoke || !editing || !focus || !value.trim()) {
      setRows([]);
      setSelected(-1);
      return;
    }
    const timer = setTimeout(() => {
      void invoke("history", { text: value, suggestions: true, limit: 6 })
        .then((result) => {
          if (current) {
            setRows(result);
            setSelected(-1);
          }
        })
        .catch(() => {
          if (current) setRows([]);
        });
    }, 65);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [editing, focus, invoke, value]);
  const submit = (url: string) => {
    if (!url.trim()) return;
    setEditing(false);
    setRows([]);
    setSelected(-1);
    change(url);
    inputRef.current?.blur();
    navigate(url.trim());
  };
  let domain: string | undefined;
  if (invoke && !focus && /^https?:\/\//i.test(value)) {
    try {
      domain = new URL(value).host;
    } catch {
      /* Keep partially entered URLs visible. */
    }
  }
  const open = focus && editing && Boolean(rows.length) && Boolean(slot);
  return (
    <>
      <form
        data-domain={domain || undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (!composing(inputRef.current)) submit(open && selected >= 0 ? rows[selected]!.url : value);
        }}
      >
        {domain && (
          <span className={styles.addressHost} aria-hidden="true">
            {domain}
          </span>
        )}
        <input
          ref={inputRef}
          value={value}
          aria-label={label}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && selected >= 0 ? listId + "-" + selected : undefined}
          onFocus={() => setFocus(true)}
          onBlur={() => {
            setFocus(false);
            setEditing(false);
          }}
          onCompositionStart={(event) => {
            event.currentTarget.dataset.composing = "true";
          }}
          onCompositionEnd={(event) => {
            delete event.currentTarget.dataset.composing;
          }}
          onChange={(event) => {
            change(event.target.value);
            setRows([]);
            setSelected(-1);
            setEditing(true);
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              composing(event.currentTarget)
            )
              return;
            if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
              setSelected(-1);
            }
            if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setSelected((index) =>
                event.key === "ArrowDown" ? (index + 1) % rows.length : index <= 0 ? rows.length - 1 : index - 1,
              );
            }
          }}
        />
      </form>
      {open &&
        createPortal(
          <div id={listId} role="listbox" aria-label={label} className={styles.suggestions}>
            {rows.map((row, i) => (
              <button
                type="button"
                key={row.id}
                id={listId + "-" + i}
                role="option"
                aria-selected={selected === i}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => submit(row.url)}
              >
                <AliIcon name="history" size={15} />
                <span>
                  <strong>{row.title || row.url}</strong>
                  <small>{row.url}</small>
                </span>
              </button>
            ))}
          </div>,
          slot!,
        )}
    </>
  );
}
function composing(input: HTMLInputElement | null) {
  return input?.dataset.composing === "true";
}
