"use client";

import { useEffect, useMemo, useState } from "react";
import type { CordisAction, CordisCheckResult, CordisDiscoveryEntry, CordisEntry } from "@/desktop/src/cordis-extension-contract";
import type { DesktopExtensionEntry, DesktopExtensionId, DesktopExtensionState } from "@/desktop/src/desktop-extension-registry";
import { useI18n } from "@/hooks/useI18n";
import styles from "./DesktopExtensionsSettings.module.css";
import settingsStyles from "./SettingsDialog.module.css";

const changing = new Set(["installing", "updating", "starting", "stopping"]);

function CordisCard({ entry }: { entry: CordisEntry }) {
  const { t, locale } = useI18n();
  const { state, compatibility } = entry;
  const latest = entry.releases[0]?.version;
  const [version, setVersion] = useState(latest);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const busy = pending || changing.has(state.phase);
  const release = entry.releases.find(release => release.version === (state.version ?? version)) ?? entry.releases[0];
  const chooseVersion = state.version === null && entry.releases.length > 1;
  const canUpdate = Boolean(state.version && (entry.community
    ? entry.releases.findIndex(release => release.version === state.version) > 0 : latest && state.version !== latest));
  const description = locale === "zh-CN" ? entry.description.zh : entry.description.en;
  const note = entry.community?.note[locale === "zh-CN" ? "zh" : "en"];

  async function change(action: CordisAction | "autoStart", target?: string) {
    const bridge = window.piDesktop?.desktopExtensions?.cordis;
    if (!bridge || pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (action === "autoStart") await bridge.autoStart(entry.id, !state.autoStart);
      else await bridge.action(entry.id, action, target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setPending(false); }
  }

  return (
    <article className={entry.community ? styles.communityEntry : styles.card} data-desktop-extension={entry.id} aria-labelledby={entry.id + "-title"}>
      <div className={styles.header}>
        <div>
          <h3 id={entry.id + "-title"}>{entry.community
            ? <a href={entry.source} target="_blank" rel="noreferrer">{entry.name}</a> : entry.name}</h3>
          <p>{entry.community ? t("desktopExtensions.discovered.verified") + " · " + entry.community.package : t("desktopExtensions.cordisVerified") + " · Cordis " + compatibility.cordis}</p>
        </div>
        <span role="status">{t("desktopExtensions.state." + state.phase)}</span>
      </div>
      <p>{description}</p>
      {note && <p className={styles.description}>{note}</p>}
      {state.version && <p className={styles.description}>
        {t("desktopExtensions.installedVersion", { version: state.version })}
        {state.runningVersion && " · " + t("desktopExtensions.runningVersion", { version: state.runningVersion })}
        {state.previousVersion && " · " + t("desktopExtensions.previousVersion", { version: state.previousVersion })}
      </p>}
      {chooseVersion && <label className={styles.versionPicker}>
        {t("desktopExtensions.versionToInstall")}
        <select value={version} onChange={event => setVersion(event.target.value)} disabled={busy || Boolean(compatibility.reason)}>
          {entry.releases.map(release => <option key={release.version}>{release.version}</option>)}
        </select>
      </label>}
      {state.progress && <p role="status">{t("desktopExtensions.progress." + state.progress.stage)}
        {state.progress.total ? " " + Math.min(100, Math.floor(state.progress.received / state.progress.total * 100)) + "%" : ""}
      </p>}
      <div className={styles.actions}>
        {changing.has(state.phase) && state.phase !== "stopping" && (
          <button type="button" disabled={pending} onClick={() => void change("cancel")}>{t("common.cancel")}</button>
        )}
        {!state.version ? (
          <button type="button" disabled={busy || Boolean(compatibility.reason)} onClick={() => void change("install", version)}>
            {t(entry.community ? "desktopExtensions.installVersion" : "desktopExtensions.installExtension", { version: version ?? "" })}
          </button>
        ) : (
          <>
            <button type="button" disabled={busy || state.phase !== "running" && Boolean(compatibility.reason)}
              onClick={() => void change(state.phase === "running" ? "stop" : "start")}>
              {t(state.phase === "running" ? "desktopExtensions.stop" : "desktopExtensions.start")}
            </button>
            {compatibility.panel && <button type="button" disabled={busy || state.phase !== "running"} onClick={() => void change("panel")}>
              {t("desktopExtensions.openPanel")}
            </button>}
            {canUpdate && <button type="button" disabled={busy} onClick={() => void change("update", latest)}>
              {t("desktopExtensions.updateTo", { version: latest ?? "" })}
            </button>}
            <button type="button" disabled={busy} onClick={() => void change("uninstall")}>{t("desktopExtensions.uninstall")}</button>
          </>
        )}
      </div>
      {state.version && <div className={styles.option}>
        <span>{t("desktopExtensions.autoStart")}</span>
        <button type="button" className={settingsStyles.switch} role="switch" aria-label={t("desktopExtensions.autoStart")}
          aria-checked={state.autoStart} disabled={busy} onClick={() => void change("autoStart")}><span /></button>
      </div>}
      {state.operation && <p role="status">{t("desktopExtensions.operation." + state.operation.outcome)}</p>}
      {(error || state.error || compatibility.reason) && <p className={styles.error} role="alert">{error || state.error || compatibility.reason}</p>}
      <details className={styles.extensionDetails}>
        <summary>{t("desktopExtensions.versionsAndPermissions")}</summary>
        <p>{t("desktopExtensions.verifiedCombination", { cordis: compatibility.cordis, api: String(compatibility.hostApi) })}</p>
        {compatibility.services.length > 0 && <p>{compatibility.services.join(" · ")}</p>}
        {entry.assetsLicense && <p>{t("desktopExtensions.assetLicense", { license: entry.assetsLicense })}</p>}
        <ul>
          {release?.packages.map(pkg => <li key={pkg.name}>
            <a href={pkg.source} target="_blank" rel="noreferrer">{pkg.name} {pkg.version}</a> · {pkg.license}
            <details><summary>{t("desktopExtensions.integrity")}</summary><code>{pkg.integrity}</code></details>
          </li>)}
        </ul>
      </details>
      {state.logs.length > 0 && <details className={styles.extensionDetails}>
        <summary>{t("desktopExtensions.diagnostics")}</summary>
        <pre>{state.logs.join("\n")}</pre>
      </details>}
    </article>
  );
}

type UpdateDedicated = (id: DesktopExtensionId, state: DesktopExtensionState) => void;

function CommunityListing({ entry, dedicated, updateDedicated }: {
  entry: CordisDiscoveryEntry;
  dedicated?: DesktopExtensionEntry;
  updateDedicated: UpdateDedicated;
}) {
  const { t, locale } = useI18n();
  const [check, setCheck] = useState<CordisCheckResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const state = dedicated?.state;
  const compatibility = check?.compatibility ?? (entry.package && entry.version ? entry.compatibility : "unavailable");
  const description = dedicated ? t(dedicated.manifest.id === "dsh-pet" ? "desktopExtensions.petDescription" : "desktopExtensions.memeDescription")
    : entry.description[locale === "zh-CN" ? "zh" : "en"] || entry.description.en || entry.description.zh;

  async function checkOrInstall() {
    const bridge = window.piDesktop?.desktopExtensions;
    if (!bridge || pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (dedicated) updateDedicated(dedicated.manifest.id, await bridge.action(dedicated.manifest.id, "install"));
      else if (bridge.cordis) setCheck(await bridge.cordis.check(entry.package, entry.version));
    } catch (cause) {
      setError(dedicated ? (cause instanceof Error ? cause.message : String(cause)) : t("desktopExtensions.checkFailed"));
    } finally { setPending(false); }
  }

  return <li data-community-package={entry.package ?? undefined}>
    <div className={styles.header}>
      {entry.source ? <a href={entry.source} target="_blank" rel="noreferrer">{entry.name}</a> : <strong>{entry.name}</strong>}
      <span role="status">{state ? t("desktopExtensions.state." + state.phase) : t("desktopExtensions.discovered." + compatibility)}</span>
    </div>
    {entry.package && <p className={styles.description}>{[entry.package, entry.version].filter(Boolean).join(" ")}
      {dedicated && " · " + t("desktopExtensions.discovered.dedicated")}</p>}
    {description && <p>{description}</p>}
    {!entry.package || !entry.version ? <p className={styles.description}>
      {t("desktopExtensions.check." + (entry.package ? "missingVersion" : "missingNpm"))}
    </p> : <div className={styles.actions}>
      {dedicated
        ? state && !state.installed && <button type="button" disabled={pending || changing.has(state.phase)} onClick={() => void checkOrInstall()}>
          {t("desktopExtensions.installVersion", { version: entry.version })}
        </button>
        : <button type="button" disabled={pending} onClick={() => void checkOrInstall()}>
          {t(pending ? "desktopExtensions.checking" : check ? "desktopExtensions.checkAgain" : "desktopExtensions.checkCompatibility")}
        </button>}
    </div>}
    {check && <ul className={styles.checkReasons} aria-live="polite">
      {check.reasons.map(reason => <li key={reason.code}>
        {t("desktopExtensions.check." + reason.code)}
        {reason.detail && <code>{reason.detail}</code>}
      </li>)}
    </ul>}
    {(error || state?.error) && <p className={styles.error} role="alert">{error || state?.error}</p>}
  </li>;
}

function CommunityDirectory({ profiles, dedicated, updateDedicated }: {
  profiles: CordisEntry[];
  dedicated: readonly DesktopExtensionEntry[] | undefined;
  updateDedicated: UpdateDedicated;
}) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<CordisDiscoveryEntry[]>();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function discover() {
    const bridge = window.piDesktop?.desktopExtensions?.cordis;
    if (!bridge || loading) return;
    setLoading(true);
    setError(undefined);
    try { setEntries(await bridge.discover()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }
  const normalized = query.trim().toLocaleLowerCase();
  const language = locale === "zh-CN" ? "zh" : "en";
  const matches = (...fields: (string | null | undefined)[]) => fields.some(field => field?.toLocaleLowerCase().includes(normalized));
  const verified = profiles.filter(entry =>
    matches(entry.name, entry.community?.package, entry.description[language], ...entry.releases.map(release => release.version)));
  const adapters = dedicated?.filter(({ manifest }) => matches(manifest.name, manifest.id, manifest.version)) ?? [];
  const visible = useMemo(() => (entries ?? []).filter(entry => !entry.verifiedId && entry.compatibility !== "dedicated" && (!normalized
    || [entry.name, entry.package, entry.version, entry.description[language]].some(field => field?.toLocaleLowerCase().includes(normalized)))),
  [entries, language, normalized]);

  return (
    <section className={styles.card} aria-labelledby="desktop-extensions-community-title">
      <div className={styles.header}>
        <div>
          <h3 id="desktop-extensions-community-title">{t("desktopExtensions.communityDirectory")}</h3>
          <p>{t("desktopExtensions.communityDescription")}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={loading} onClick={() => void discover()}>
            {t(entries ? "desktopExtensions.refreshDirectory" : "desktopExtensions.loadDirectory")}
          </button>
        </div>
      </div>
      {loading && <p role="status">{t("desktopExtensions.directoryLoading")}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {(profiles.length > 0 || dedicated?.length || entries) && <>
        <label className={styles.directorySearch}>
          <span>{t("desktopExtensions.searchDirectory")}</span>
          <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} />
        </label>
        {verified.length === 0 && adapters.length === 0 && visible.length === 0 && <p role="status">{t(entries ? "settings.searchEmpty" : "desktopExtensions.loadToSearch")}</p>}
        <ul className={styles.discoveryList}>
          {verified.map(entry => <li key={entry.id}><CordisCard entry={entry} /></li>)}
          {adapters.map(adapter => <CommunityListing
            key={adapter.manifest.id}
            entry={{ name: adapter.manifest.name, package: adapter.manifest.id, version: adapter.manifest.version,
              description: { en: "", zh: "" }, source: adapter.manifest.source, compatibility: "dedicated", verifiedId: null }}
            dedicated={adapter}
            updateDedicated={updateDedicated}
          />)}
          {visible.slice(0, limit).map((entry, index) => <CommunityListing
            key={JSON.stringify([entry.package, entry.version, entry.name, entry.source, index])}
            entry={entry}
            updateDedicated={updateDedicated}
          />)}
        </ul>
        {visible.length > limit && <div className={styles.actions}>
          <button type="button" onClick={() => setLimit(count => count + 30)}>{t("desktopExtensions.moreDirectoryResults")}</button>
        </div>}
      </>}
    </section>
  );
}

export function CordisDirectorySettings({ dedicated, updateDedicated }: {
  dedicated: readonly DesktopExtensionEntry[] | undefined;
  updateDedicated: UpdateDedicated;
}) {
  const { t } = useI18n();
  const [available, setAvailable] = useState(false);
  const [entries, setEntries] = useState<CordisEntry[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const bridge = window.piDesktop?.desktopExtensions?.cordis;
    if (!bridge) return;
    setAvailable(true);
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (document.visibilityState !== "hidden") {
          const entries = await bridge!.list();
          if (!closed) { setEntries(entries); setError(undefined); }
        }
      } catch (cause) {
        if (!closed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!closed) timer = setTimeout(poll, 800);
      }
    }
    void poll();
    return () => { closed = true; clearTimeout(timer); };
  }, []);

  if (!available) return null;
  return (
    <section className={styles.directory} data-settings-id="desktopExtensions.directory" aria-labelledby="desktop-extensions-directory-title">
      <h3 id="desktop-extensions-directory-title">{t("desktopExtensions.directoryTitle")}</h3>
      {!entries && !error && <p role="status">{t("desktopExtensions.loading")}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {entries?.filter(entry => !entry.community).map(entry => <CordisCard key={entry.id} entry={entry} />)}
      <CommunityDirectory profiles={entries?.filter(entry => entry.community) ?? []} dedicated={dedicated} updateDedicated={updateDedicated} />
    </section>
  );
}
