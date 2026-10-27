import { formatShortcutBinding } from "@/lib/keyboard-shortcuts";
import styles from "./ShortcutSettings.module.css";

const symbols: Record<string, string> = {
  Ctrl: "⌃", Cmd: "⌘", Meta: "⌘", Alt: "⌥", Shift: "⇧",
  Enter: "↵", Tab: "⇥", Escape: "⎋", Backspace: "⌫", Delete: "⌦",
  Space: "␣", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

export function ShortcutKeycaps({ binding, mac }: { binding: string | null; mac?: boolean }) {
  const label = formatShortcutBinding(binding, mac);
  return <span className={styles.keycaps} role="img" aria-label={label} title={label}>
    {label.split("+").filter(Boolean).map((key) => <kbd key={key} aria-hidden="true">{symbols[key] ?? key}</kbd>)}
  </span>;
}
