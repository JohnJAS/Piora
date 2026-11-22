"use client";

import { useEffect, useState } from "react";
import type { BrowserSection, BrowserTarget } from "@/desktop/src/browser/contracts";
import { ContactBook } from "./BrowserContacts";
import { BrowserRecords } from "./BrowserRecords";
import { ProfileImport } from "./BrowserImport";
import { PrivacyControls } from "./BrowserPrivacy";
import { errorText, openBrowserSettings, sectionLabels, useBrowserCopy, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

export function BrowserProfileSection({
  section,
  bridge,
  target,
  navigate,
  close,
  expand,
}: {
  section: BrowserSection | "recent";
  bridge: ToolsBridge;
  target?: BrowserTarget;
  navigate(url: string): void;
  close(): void;
  expand?(): void;
}) {
  const { copy } = useBrowserCopy();
  const label = section === "recent" ? copy("近期下载", "Recent downloads") : copy(...sectionLabels[section]);
  return (
    <section
      className={section === "recent" ? styles.recent : styles.sheet}
      aria-label={label}
      data-profile-section={section}
    >
      <header className={styles.heading}>
        <h3>{label}</h3>
        <button type="button" aria-label={copy("关闭管理页", "Close manager")} onClick={close}>
          ×
        </button>
      </header>
      {section === "downloads" || section === "recent" || section === "history" ? (
        <BrowserRecords
          key={section}
          bridge={bridge}
          kind={section === "history" ? "history" : "downloads"}
          recent={section === "recent"}
          navigate={navigate}
          expand={expand}
        />
      ) : section === "contacts" ? (
        <ContactBook bridge={bridge} target={target} />
      ) : section === "import" ? (
        <ProfileImport bridge={bridge} />
      ) : section === "privacy" ? (
        <PrivacyControls bridge={bridge} />
      ) : (
        <DeviceDefaults bridge={bridge} />
      )}
    </section>
  );
}
function DeviceDefaults({ bridge }: { bridge: ToolsBridge }) {
  const { copy } = useBrowserCopy();
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    void bridge
      .tools("deviceDefault", null)
      .then((value) => {
        if (current) setEnabled(value);
      })
      .catch((e) => {
        if (current) setError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, [bridge]);
  return (
    <>
      <label className={styles.check}>
        <input
          type="checkbox"
          disabled={enabled === null}
          checked={Boolean(enabled)}
          onChange={(event) => {
            void bridge
              .tools("deviceDefault", event.target.checked)
              .then(setEnabled)
              .catch((e) => setError(errorText(e)));
          }}
        />
        {copy("新标签默认开启设备工具栏", "Show device toolbar in new tabs")}
      </label>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function ProfileSettingsHome({ bridge, navigate }: { bridge: ToolsBridge; navigate(url: string): void }) {
  const { copy } = useBrowserCopy();
  const [section, setSection] = useState<BrowserSection | null>(null);
  return (
    <div className={styles.home}>
      {section ? (
        <BrowserProfileSection
          section={section}
          bridge={bridge}
          navigate={navigate}
          close={() => setSection(null)}
        />
      ) : (
        <nav className={styles.actions} aria-label={copy("浏览器资料与工具", "Browser data and tools")}>
          {(Object.keys(sectionLabels) as BrowserSection[]).map((key) => (
            <button key={key} type="button" onClick={() => setSection(key)}>
              {copy(...sectionLabels[key])}
            </button>
          ))}
          <button type="button" onClick={() => openBrowserSettings("vault")}>
            {copy("密码管理器", "Password manager")}
          </button>
        </nav>
      )}
    </div>
  );
}
