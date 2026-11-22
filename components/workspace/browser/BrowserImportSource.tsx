"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AliIcon } from "@/components/AliIcon";
import type { ImportBrowser, ImportSource } from "@/desktop/src/browser/contracts";
import { useBrowserCopy } from "./shared";
import styles from "./BrowserTools.module.css";

export const browserNames: Record<ImportBrowser, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  piora: "Piora",
};

function Brand({ browser }: { browser: ImportBrowser }) {
  return browser === "chrome" ? (
    <i className={styles.chromeMark} aria-hidden="true" />
  ) : (
    <AliIcon name={browser === "piora" ? "desktop" : "earth"} size={16} />
  );
}

export function BrowserImportSource({
  options,
  current,
  disabled,
  select,
}: {
  options: ImportSource[];
  current?: ImportSource;
  disabled: boolean;
  select(source: ImportSource): void;
}) {
  const { copy } = useBrowserCopy();
  const label = copy("来源浏览器和个人资料", "Source browser and profile");
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    control = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((row) => row.id === current?.id),
      ),
    );
    setOpen(true);
  };
  const pick = (row: ImportSource) => {
    select(row);
    setOpen(false);
    control.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(id + "-" + active)?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  return (
    <div className={styles.sourceLine}>
      <span>{copy("从", "From")}</span>
      <div className={styles.profilePicker} ref={root}>
        <button
          type="button"
          ref={control}
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-activedescendant={open ? id + "-" + active : undefined}
          disabled={disabled || !current}
          onClick={() => (open ? setOpen(false) : show())}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              return;
            }
            if (event.key === "Tab") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) show();
              else
                setActive(
                  (index) => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length,
                );
              return;
            }
            if (open && (event.key === "Home" || event.key === "End")) {
              event.preventDefault();
              setActive(event.key === "Home" ? 0 : options.length - 1);
              return;
            }
            if (open && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              if (options[active]) pick(options[active]);
            }
          }}
        >
          {current && (
            <>
              <Brand browser={current.browser} />
              <span>{browserNames[current.browser]}</span>
              <small title={current.account || current.directory}>{current.name}</small>
            </>
          )}
          <AliIcon name="chevron-down" size={14} />
        </button>
        {open && (
          <div id={id} role="listbox" aria-label={label} className={styles.profileOptions}>
            {options.map((row, index) => {
              const duplicate =
                row.name &&
                options.some(
                  (other) => other.id !== row.id && other.browser === row.browser && other.name === row.name,
                );
              const detail = duplicate
                ? row.account &&
                  !options.some(
                    (other) =>
                      other.id !== row.id && other.browser === row.browser && other.account === row.account,
                  )
                  ? row.account
                  : row.directory
                : "";
              return (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={id + "-" + index}
                  key={row.id}
                  data-source-id={row.id}
                  aria-selected={row.id === current?.id}
                  data-active={index === active || undefined}
                  title={[row.name, row.account, row.directory].filter(Boolean).join(" · ")}
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(row)}
                >
                  <Brand browser={row.browser} />
                  <span>{browserNames[row.browser]}</span>
                  <small>{row.name}</small>
                  {detail && <small className={styles.profileHint}>{detail}</small>}
                  {row.id === current?.id && <AliIcon name="check" size={14} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
