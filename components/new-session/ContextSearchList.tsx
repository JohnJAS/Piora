"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AliIcon, type AliIconName } from "../AliIcon";
import styles from "./NewSessionContextMenu.module.css";

export interface ContextOption {
  id: string;
  name: string;
  icon: AliIconName;
  selected: boolean;
  title?: string;
  detail?: string;
}

export function ContextSearchList({
  label, options, empty, onSearch, onSelect, footer,
}: {
  label: string;
  options: ContextOption[];
  empty: string;
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
  footer?: ReactNode;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    list.current?.children.item(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return <>
    <label className={styles.search}>
      <AliIcon name="search" size={15} />
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        placeholder={label}
        onChange={(event) => { setActive(-1); onSearch(event.target.value); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || !options.length) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const direction = event.key === "ArrowDown" ? 1 : -1;
            setActive((index) => (index < 0 ? direction === 1 ? 0 : options.length - 1 : (index + direction + options.length) % options.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            onSelect((options[active] ?? options[0]).id);
          }
        }}
      />
    </label>
    <div ref={list} id={listId} role="listbox" aria-label={label} className={styles.list}>
      {options.map((option, index) => (
        <button
          type="button"
          key={option.id}
          id={`${listId}-${index}`}
          role="option"
          tabIndex={-1}
          aria-selected={option.selected}
          data-active={active === index ? "" : undefined}
          className={styles.row}
          title={option.title ?? option.name}
          onClick={() => onSelect(option.id)}
        >
          <AliIcon name={option.icon} size={15} />
          <span className={styles.optionText}>
            <span>{option.name}</span>
            {option.detail && <small>{option.detail}</small>}
          </span>
          {option.selected && <AliIcon name="check" size={14} className={styles.check} />}
        </button>
      ))}
    </div>
    {options.length === 0 && <p className={styles.status} role="status">{empty}</p>}
    {footer && <div className={styles.actions}>{footer}</div>}
  </>;
}
