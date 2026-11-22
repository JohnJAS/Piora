"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AliIcon, type AliIconName } from "@/components/AliIcon";
import { CredentialVaultSettings } from "@/components/CredentialVaultSettings";
import type { BrowserTarget } from "@/desktop/src/browser/contracts";
import { BrowserRecords } from "./BrowserRecords";
import { ContactBook } from "./BrowserContacts";
import { errorText, sectionLabels, useBrowserCopy, type BrowserSettingsPage, type ToolsBridge } from "./shared";
import styles from "./BrowserTools.module.css";

type Destination = BrowserSettingsPage | "import" | "privacy";
const icons: Record<Destination, AliIconName> = {
  browser: "earth",
  passwordManager: "key",
  vault: "key",
  history: "history",
  downloads: "download",
  contacts: "user",
  devices: "mobile",
  import: "import",
  privacy: "clear",
};
function initialRoute(requested?: string): BrowserSettingsPage[] {
  const page = requested?.replace(/^browser\.page\./, "");
  if (page === "vault") return ["browser", "passwordManager", "vault"];
  if (
    page === "history" ||
    page === "downloads" ||
    page === "contacts" ||
    page === "passwordManager" ||
    page === "devices"
  )
    return ["browser", page];
  return ["browser"];
}

export function ProfileSettingsHome({
  bridge,
  navigate,
  requestedPage,
  children,
}: {
  bridge: ToolsBridge;
  navigate(url: string): void;
  requestedPage?: string;
  children: ReactNode;
}) {
  const { copy } = useBrowserCopy();
  const [route, setRoute] = useState(() => initialRoute(requestedPage));
  const [forward, setForward] = useState<BrowserSettingsPage[]>([]);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<BrowserTarget>();
  const page = route[route.length - 1]!;
  const labels: Record<Destination, string> = {
    browser: copy("浏览器", "Browser"),
    passwordManager: copy("密码管理器", "Password manager"),
    vault: copy("管理密码", "Manage passwords"),
    ...Object.fromEntries(Object.entries(sectionLabels).map(([key, pair]) => [key, copy(...pair)])),
  } as Record<Destination, string>;
  useEffect(() => {
    setRoute(initialRoute(requestedPage));
    setForward([]);
    setError("");
  }, [requestedPage]);
  useEffect(() => {
    let live = true;
    if (page === "contacts")
      void window.piDesktop?.browser
        ?.getState()
        .then((s) => {
          if (live)
            setTarget(
              s?.activeTabId && s.url !== "about:blank"
                ? { tabId: s.activeTabId, sessionId: s.sessionId, navigationEpoch: s.navigationEpoch }
                : undefined,
            );
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [page]);
  const open = (next: Destination) => {
    setError("");
    if (next === "import" || next === "privacy") {
      void bridge
        .tools("modal", next)
        .then((value) => {
          if (value === "vault") {
            setRoute(["browser", "passwordManager", "vault"]);
            setForward([]);
          }
        })
        .catch((e) => setError(errorText(e)));
      return;
    }
    setRoute((previous) => [...previous, next]);
    setForward([]);
  };
  const backTo = (index: number) => {
    if (index < 0 || index >= route.length - 1) return;
    setForward((previous) => [...route.slice(index + 1), ...previous]);
    setRoute(route.slice(0, index + 1));
    setError("");
  };
  const links = (keys: Destination[]) => (
    <div className={styles.navList}>
      {keys.map((key) => (
        <button type="button" className={styles.navRow} key={key} onClick={() => open(key)}>
          <AliIcon name={icons[key]} size={17} />
          <span>{labels[key]}</span>
          <AliIcon name="chevron-right" size={14} />
        </button>
      ))}
    </div>
  );
  return (
    <div className={styles.home}>
      <nav className={styles.crumbs} aria-label={copy("浏览器设置路径", "Browser settings path")}>
        <button
          type="button"
          disabled={route.length < 2}
          onClick={() => backTo(route.length - 2)}
          aria-label={copy("后退", "Go back")}
        >
          <AliIcon name="arrowleft" size={15} />
        </button>
        <button
          type="button"
          disabled={!forward.length}
          onClick={() => {
            setRoute([...route, forward[0]!]);
            setForward(forward.slice(1));
          }}
          aria-label={copy("前进", "Go forward")}
        >
          <AliIcon name="arrowright" size={15} />
        </button>
        {route.map((key, index) => (
          <span key={key} className={styles.crumb}>
            {index > 0 && <AliIcon name="chevron-right" size={12} />}
            {index === route.length - 1 ? (
              <span aria-current="page">{labels[key]}</span>
            ) : (
              <button type="button" onClick={() => backTo(index)}>
                {labels[key]}
              </button>
            )}
          </span>
        ))}
      </nav>
      <section className={styles.pageBody} data-profile-section={page} aria-label={labels[page]}>
        {page === "browser" ? (
          <>
            {children}
            {links(["history", "downloads", "passwordManager", "contacts", "import", "privacy", "devices"])}
          </>
        ) : (
          <>
            <h2 className={styles.pageTitle}>{labels[page]}</h2>
            {page === "passwordManager" && links(["vault", "contacts"])}
            {page === "vault" && <CredentialVaultSettings browserPage importPasswords={() => open("import")} />}
            {(page === "downloads" || page === "history") && (
              <BrowserRecords key={page} bridge={bridge} kind={page} navigate={navigate} />
            )}
            {page === "contacts" && <ContactBook bridge={bridge} target={target} />}
            {page === "devices" && <DeviceDefaults bridge={bridge} />}
          </>
        )}
        {error && (
          <p className={styles.feedback} role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
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
