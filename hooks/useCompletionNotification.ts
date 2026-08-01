"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "pi-completion-notifications-enabled";
const MAX_TASK_TITLE_LENGTH = 80;

type DesktopNotificationBridge = {
  notifyCompletion?: (taskTitle?: string) => Promise<boolean>;
};

export type CompletionNotificationCapability = "desktop" | "browser" | "unsupported";

function getDesktopNotificationBridge(): DesktopNotificationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { piDesktop?: DesktopNotificationBridge }).piDesktop;
}

export function sanitizeCompletionTaskTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return Array.from(normalized).slice(0, MAX_TASK_TITLE_LENGTH).join("");
}

function getBrowserNotificationCopy(taskTitle: string | undefined): {
  title: string;
  body: string;
} {
  const isChinese = typeof navigator !== "undefined"
    && navigator.language.toLowerCase().startsWith("zh");
  return {
    title: taskTitle ? `${taskTitle} - piGUI` : "piGUI",
    body: isChinese
      ? "任务已完成，可以回到 piGUI 查看结果。"
      : "Task completed. Open piGUI to review the result.",
  };
}

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

export function useCompletionNotification() {
  const [enabled, setEnabled] = useState(false);
  const [capability, setCapability] = useState<CompletionNotificationCapability>(
    "unsupported",
  );
  const enabledRef = useRef(false);

  const commitEnabled = useCallback((next: boolean) => {
    enabledRef.current = next;
    setEnabled(next);
    writeStoredPreference(next);
    return next;
  }, []);

  useEffect(() => {
    const desktopBridge = getDesktopNotificationBridge();
    if (desktopBridge?.notifyCompletion) {
      setCapability("desktop");
      commitEnabled(readStoredPreference());
      return;
    }

    if (typeof Notification === "undefined") {
      setCapability("unsupported");
      commitEnabled(false);
      return;
    }

    setCapability("browser");
    commitEnabled(readStoredPreference() && Notification.permission === "granted");
  }, [commitEnabled]);

  const setNotificationEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    if (!next) return commitEnabled(false);

    const desktopBridge = getDesktopNotificationBridge();
    if (desktopBridge?.notifyCompletion) return commitEnabled(true);
    if (typeof Notification === "undefined") return commitEnabled(false);

    const permission = Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied" as const)
      : Notification.permission;
    return commitEnabled(permission === "granted");
  }, [commitEnabled]);

  const toggleNotification = useCallback(
    () => setNotificationEnabled(!enabledRef.current),
    [setNotificationEnabled],
  );

  const notifyCompletion = useCallback(async (taskTitle?: string): Promise<boolean> => {
    if (!enabledRef.current) return false;
    const safeTaskTitle = sanitizeCompletionTaskTitle(taskTitle);

    const desktopBridge = getDesktopNotificationBridge();
    if (desktopBridge?.notifyCompletion) {
      try {
        return await desktopBridge.notifyCompletion(safeTaskTitle);
      } catch {
        return false;
      }
    }

    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      commitEnabled(false);
      return false;
    }

    try {
      const copy = getBrowserNotificationCopy(safeTaskTitle);
      new Notification(copy.title, {
        body: copy.body,
        tag: "pigui-task-complete",
      });
      return true;
    } catch {
      return false;
    }
  }, [commitEnabled]);

  return {
    notificationEnabled: enabled,
    notificationEnabledRef: enabledRef,
    notificationCapability: capability,
    setNotificationEnabled,
    onNotificationToggle: toggleNotification,
    notifyCompletion,
  };
}
