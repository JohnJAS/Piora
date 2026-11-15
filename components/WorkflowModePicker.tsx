"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { DEFAULT_WORKFLOW_TURN_BUDGET, MAX_WORKFLOW_TURN_BUDGET, type WorkflowMode, type WorkflowPromptOptions } from "@/lib/workflow-types";
import { WorkflowModeIcon } from "./WorkflowModeIcon";
import styles from "./WorkflowModePicker.module.css";

const MODES = ["agent", "plan", "goal"] as const;
const POINTER_LEAVE_DELAY_MS = 200;
const MENU_GAP = 8;
const VIEWPORT_MARGIN = 8;

type PointerPosition = { pointerType: string; clientX: number; clientY: number; target: EventTarget | null };

export function WorkflowModePicker({ value, onChange, disabled }: {
  value: WorkflowPromptOptions;
  onChange: (value: WorkflowPromptOptions) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const helpId = useId();
  const [expanded, setExpanded] = useState(false);
  const [focusedMode, setFocusedMode] = useState<WorkflowMode>(value.mode);
  const [position, setPosition] = useState<CSSProperties>({});
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Partial<Record<WorkflowMode, HTMLButtonElement | null>>>({});
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const openFocusRef = useRef<WorkflowMode>(value.mode);
  const returnFocusRef = useRef(false);
  const isExpanded = expanded && !disabled;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback((returnFocus = false) => {
    clearCloseTimer();
    returnFocusRef.current = returnFocus && Boolean(menuRef.current?.contains(document.activeElement));
    setExpanded(false);
  }, [clearCloseTimer]);

  const schedulePointerClose = useCallback(() => {
    if (closeTimerRef.current === null) {
      closeTimerRef.current = setTimeout(() => close(true), POINTER_LEAVE_DELAY_MS);
    }
  }, [close]);

  const isInsideControls = useCallback((target: EventTarget | null) => {
    return target instanceof Node && Boolean(toggleRef.current?.contains(target) || menuRef.current?.contains(target));
  }, []);

  const isInPointerRegion = useCallback((event: PointerPosition) => {
    if (isInsideControls(event.target)) return true;
    const trigger = toggleRef.current?.getBoundingClientRect();
    const menu = menuRef.current?.getBoundingClientRect();
    if (!trigger || !menu) return false;
    // The small gap is a bridge, so moving between the button and its portal
    // never starts a dismissal timer, even when the pointer pauses there.
    const above = menu.bottom <= trigger.top;
    const below = trigger.bottom <= menu.top;
    const top = above ? menu.bottom : trigger.bottom;
    const bottom = above ? trigger.top : menu.top;
    return (above || below)
      && event.clientX >= Math.min(trigger.left, menu.left)
      && event.clientX <= Math.max(trigger.right, menu.right)
      && event.clientY >= top && event.clientY <= bottom;
  }, [isInsideControls]);

  const trackPointer = useCallback((event: PointerPosition) => {
    if (event.pointerType === "touch") return;
    if (isInPointerRegion(event)) {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      clearCloseTimer();
    } else {
      const previous = pointerPositionRef.current;
      // Selecting Goal can reflow the footer under a stationary pointer.
      // Wait for actual movement outside, rather than that layout change.
      if (previous && (previous.x !== event.clientX || previous.y !== event.clientY)) schedulePointerClose();
    }
  }, [isInPointerRegion, clearCloseTimer, schedulePointerClose]);

  const open = (mode: WorkflowMode = value.mode) => {
    if (disabled) return;
    clearCloseTimer();
    returnFocusRef.current = false;
    openFocusRef.current = mode;
    setFocusedMode(mode);
    setExpanded(true);
  };

  useLayoutEffect(() => {
    if (!isExpanded) return;
    const trigger = toggleRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      if (anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth) {
        close();
        return;
      }
      const width = menu.getBoundingClientRect().width;
      const height = menu.scrollHeight + 2;
      const above = Math.max(0, anchor.top - MENU_GAP - VIEWPORT_MARGIN);
      const below = Math.max(0, window.innerHeight - anchor.bottom - MENU_GAP - VIEWPORT_MARGIN);
      const openAbove = above >= height || above >= below;
      const next: CSSProperties = {
        left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, window.innerWidth - width - VIEWPORT_MARGIN)),
        maxHeight: openAbove ? above : below,
        ...(openAbove ? { bottom: window.innerHeight - anchor.top + MENU_GAP } : { top: anchor.bottom + MENU_GAP }),
      };
      setPosition(previous => previous.left === next.left && previous.top === next.top
        && previous.bottom === next.bottom && previous.maxHeight === next.maxHeight ? previous : next);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(trigger);
    observer.observe(menu);
    const footer = trigger.closest(".chat-composer-footer");
    const footerChildren = new Set<Element>();
    const observeFooterChildren = () => {
      if (!footer) return;
      const current = new Set(Array.from(footer.children));
      for (const child of footerChildren) {
        if (!current.has(child)) {
          observer.unobserve(child);
          footerChildren.delete(child);
        }
      }
      for (const child of current) {
        if (!footerChildren.has(child)) {
          observer.observe(child, { box: "border-box" });
          footerChildren.add(child);
        }
      }
    };
    // A preceding permission control can move the anchor without resizing the
    // footer or trigger. Watch flex-item sizes and refresh them after mounting
    // or removing controls; the body portal is outside this observed subtree.
    const footerMutations = new MutationObserver(() => {
      observeFooterChildren();
      place();
    });
    if (footer) {
      observer.observe(footer);
      observeFooterChildren();
      footerMutations.observe(footer, { childList: true, subtree: true });
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      footerMutations.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isExpanded, value.mode, close]);

  useLayoutEffect(() => {
    if (isExpanded) optionRefs.current[openFocusRef.current]?.focus({ preventScroll: true });
    else if (returnFocusRef.current && !disabled) toggleRef.current?.focus({ preventScroll: true });
    returnFocusRef.current = false;
  }, [isExpanded, disabled]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  useEffect(() => {
    if (!isExpanded) return;
    const onClick = (event: MouseEvent) => {
      if (!isInsideControls(event.target)) close();
    };
    // Dismiss after the destination receives its click, so collapsing or
    // changing modes cannot move a touch target before activation.
    document.addEventListener("click", onClick);
    document.addEventListener("pointermove", trackPointer);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointermove", trackPointer);
    };
  }, [isExpanded, isInsideControls, close, trackPointer]);

  const onPointerEnter = (event: ReactPointerEvent) => {
    if (event.pointerType !== "touch") pointerPositionRef.current = { x: event.clientX, y: event.clientY };
    clearCloseTimer();
  };

  const onPointerLeave = (event: ReactPointerEvent) => {
    if (isExpanded) trackPointer({ pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY, target: event.relatedTarget });
  };

  const onBlur = (event: FocusEvent) => {
    if (!isInsideControls(event.relatedTarget)) close();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    clearCloseTimer();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // Portal DOM order differs from visual order: Tab continues from the
      // trigger to its adjacent Goal budget or the next composer control.
      const trigger = toggleRef.current;
      const controls = Array.from(document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]',
      )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled")
        && !element.closest("[inert]") && !menuRef.current?.contains(element)
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      const destination = event.shiftKey ? trigger : controls[controls.indexOf(trigger!) + 1];
      if (destination) {
        event.preventDefault();
        close();
        destination.focus({ preventScroll: true });
      } else {
        close();
      }
    }
  };

  return <div className={styles.picker}>
    <div className={styles.modeSlot} role="group" aria-label={t("workflow.mode")}
      data-testid="workflow-mode-select" data-expanded={isExpanded ? "true" : "false"}>
      <button ref={toggleRef} type="button" className={styles.toggle} data-testid="workflow-mode-toggle"
        aria-label={`${t("workflow.mode")}: ${t(`workflow.${value.mode}`)}`}
        aria-expanded={isExpanded} aria-controls={isExpanded ? `${helpId}-choices` : undefined}
        title={t(`workflow.help.${value.mode}`)} disabled={disabled}
        onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}
        onPointerDown={event => {
          if (event.pointerType !== "touch") pointerPositionRef.current = { x: event.clientX, y: event.clientY };
        }}
        onBlur={onBlur}
        onClick={() => isExpanded ? close() : open()} onKeyDown={event => {
          clearCloseTimer();
          if (event.key === "Escape" && isExpanded) {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          open(event.key === "Home" ? "agent" : event.key === "End" || event.key === "ArrowUp" ? "goal" : value.mode);
        }}>
        <WorkflowModeIcon mode={value.mode} size="1.15em" />
        <span>{t(`workflow.short.${value.mode}`)}</span>
      </button>
    </div>
    {isExpanded && createPortal(<div ref={menuRef} id={`${helpId}-choices`} role="group"
      aria-label={t("workflow.mode")} className={styles.menu} style={position} data-testid="workflow-mode-menu" data-tooltip-boundary
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onBlur={onBlur} onKeyDown={onMenuKeyDown}>
      {MODES.map(mode => <button key={mode} type="button" ref={element => { optionRefs.current[mode] = element; }}
        data-testid={`workflow-mode-${mode}`} className={styles.mode} aria-pressed={value.mode === mode}
        aria-label={t(`workflow.${mode}`)} aria-describedby={`${helpId}-${mode}`}
        title={t(`workflow.help.${mode}`)} disabled={disabled} tabIndex={focusedMode === mode ? 0 : -1}
        onFocus={() => setFocusedMode(mode)} onClick={() => {
          clearCloseTimer();
          onChange({ ...value, mode });
        }} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = MODES.indexOf(mode);
          const next = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1
            : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + MODES.length) % MODES.length;
          optionRefs.current[MODES[next]]?.focus({ preventScroll: true });
        }}>
        <WorkflowModeIcon mode={mode} size="1.15em" />
        <span>{t(`workflow.short.${mode}`)}</span>
        <span id={`${helpId}-${mode}`} hidden>{t(`workflow.help.${mode}`)}</span>
      </button>)}
    </div>, document.body)}
    {value.mode === "goal" && <label className={styles.budget}>{t("workflow.budget")}
      <input data-testid="workflow-budget-input" type="number" min={1} max={MAX_WORKFLOW_TURN_BUDGET} step={1}
        disabled={disabled} value={value.turnBudget ?? DEFAULT_WORKFLOW_TURN_BUDGET} title={t("workflow.budgetHelp")}
        onChange={event => { const number = event.currentTarget.valueAsNumber; if (Number.isSafeInteger(number) && number > 0 && number <= MAX_WORKFLOW_TURN_BUDGET) onChange({ ...value, turnBudget: number }); }} />
    </label>}
  </div>;
}
