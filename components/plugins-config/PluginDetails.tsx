"use client";

import { useEffect, useRef } from "react";
import type { PluginPackageInfo } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import styles from "../PluginsConfig.module.css";

export type PluginScope = PluginPackageInfo["scope"];
export type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

export function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

export function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

export function resourceSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

export function versionSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  const parts = [];
  if (pkg.version) parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion) parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

export function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

export function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "#f59e0b";
  if (status === "disabled") return "var(--text-dim)";
  return "#ef4444";
}

export function buttonStyle(disabled?: boolean, danger?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: danger ? "rgba(239,68,68,0.08)" : "none",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-control)",
    color: danger ? "#ef4444" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "var(--text-sm)",
    opacity: disabled ? 0.5 : 1,
  };
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = ([
    ["extension", t("i18n.extensions")],
    ["skill", t("i18n.skills")],
    ["prompt", t("i18n.prompts")],
    ["theme", t("i18n.themes")],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>
        {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
      </div>
    );
  }

  return (
    <div className={styles.resourceGrid}>
      {groups.map((group) => (
        <div className={styles.resourceCard} key={group.kind}>
          <div className={styles.resourceKind}>{group.label}</div>
          {group.resources.map((resource) => (
            <div className={styles.resourceEntry} key={`${resource.kind}:${resource.path}`}>
              <div className={styles.resourceName} title={resource.path}>{resource.name}</div>
              <div className={styles.resourcePath} title={resource.path}>{resource.relativePath}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function McpCapabilities({ info }: { info: NonNullable<PluginPackageInfo["mcpCapabilities"]> }) {
  const { t } = useI18n();
  return (
    <section className={styles.section} aria-labelledby="plugin-mcp-capabilities-title">
      <div className={styles.sectionHeading}>
        <div>
          <div className={styles.sectionTitle} id="plugin-mcp-capabilities-title">{t("plugins.mcpCapabilities")}</div>
          <div className={styles.sectionDescription}>{t("plugins.mcpCapabilitiesDescription")}</div>
        </div>
        <div className={styles.capabilityStats}>
          <span className={styles.statBadge}>{t("plugins.mcpServerCount", { count: info.enabledServerCount })}</span>
          <span className={styles.statBadge}>{t("plugins.mcpToolCount", { count: info.discoveredToolCount })}</span>
        </div>
      </div>

      {info.serverCount === 0 ? (
        <div className={styles.emptyCapability}>
          <div className={styles.emptyTitle}>{t("plugins.mcpNoServersTitle")}</div>
          <div className={styles.emptyCopy}>{t("plugins.mcpNoServersDescription")}</div>
          <code className={styles.configPath}>{info.setupPath}</code>
          <div className={styles.emptyCopy}>{t("plugins.mcpSetupHint")}</div>
        </div>
      ) : (
        <>
          <div className={styles.cacheNotice}>{t("plugins.mcpCacheNotice")}</div>
          <div className={styles.serverList}>
            {info.servers.map((server) => (
              <details className={styles.serverCard} key={server.name} open={info.servers.length === 1}>
                <summary className={styles.serverSummary}>
                  <span className={styles.serverName}>{server.name}</span>
                  <span className={styles.metaBadge}>{t(`plugins.mcpTransport.${server.transport}`)}</span>
                  <span className={styles.metaBadge}>{t("plugins.mcpToolCount", { count: server.toolCount })}</span>
                  <span className={styles.statusBadge} data-status={server.status}>{t(`plugins.mcpStatus.${server.status}`)}</span>
                </summary>
                <div className={styles.serverBody}>
                  <div className={styles.serverSource}>{t("plugins.mcpConfigSource", { source: server.source })}</div>
                  {server.tools.length > 0 ? (
                    <ul className={styles.toolList}>
                      {server.tools.map((tool) => (
                        <li className={styles.toolItem} key={tool.name}>
                          <div className={styles.toolName}>{tool.name}</div>
                          {tool.description ? <div className={styles.toolDescription}>{tool.description}</div> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className={styles.emptyCopy}>{t("plugins.mcpNoMetadata")}</div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      {info.diagnostics.length > 0 ? (
        <details className={styles.diagnostics}>
          <summary>{t("plugins.mcpDiagnostics", { count: info.diagnostics.length })}</summary>
          <ul>{info.diagnostics.map((diagnostic, index) => <li key={`${diagnostic}:${index}`}>{diagnostic}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function ScopeTag({ scope }: { scope: PluginScope }) {
  return (
    <span
      style={{
        fontSize: "var(--text-xs)",
        padding: "1px 5px",
        borderRadius: 3,
        flexShrink: 0,
        background: scope === "project" ? "rgba(99,102,241,0.12)" : "rgba(120,120,120,0.12)",
        color: scope === "project" ? "rgba(99,102,241,0.85)" : "var(--text-dim)",
      }}
    >
      {scope}
    </span>
  );
}

function Toggle({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: "var(--radius-surface)",
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
        opacity: loading ? 0.65 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function SegmentedScope({
  value,
  onChange,
}: {
  value: PluginScope;
  onChange: (scope: PluginScope) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-control)",
        overflow: "hidden",
        height: 30,
      }}
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        return (
          <button
            key={scope}
            onClick={() => onChange(scope)}
            style={{
              width: 76,
              border: "none",
              borderRight: scope === "global" ? "1px solid var(--border)" : "none",
              background: active ? "var(--bg-selected)" : "none",
              color: active ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: "var(--text-sm)",
            }}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}

export function AddPluginPanel({
  cwd,
  source,
  scope,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 660, minHeight: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ fontSize: "var(--text-base)", fontWeight: 700, color: "var(--text)" }}>
          {t("i18n.addPlugin")}
        </div>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {installLocation(scope, cwd)}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <label htmlFor="plugin-source" style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" }}>
          Source
        </label>
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          placeholder="npm:@scope/package"
          style={{
            width: "100%",
            height: 36,
            padding: "0 11px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-base)",
            outline: "none",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <SegmentedScope value={scope} onChange={onScopeChange} />
        <button
          type="button"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          style={{
            ...buttonStyle(busy || !source.trim()),
            background: "var(--accent)",
            color: "white",
            borderColor: "var(--accent)",
          }}
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text-muted)" }}>
          Examples
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSourceChange(example)}
              style={{
                width: "100%",
                minHeight: 30,
                textAlign: "left",
                padding: "6px 9px",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                background: "var(--bg-panel)",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-dim)";
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div style={{ fontSize: "var(--text-sm)", color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}

export function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;

  return (
    <div className={styles.detail}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180, flex: 1 }}>
          <Toggle
            enabled={enabled}
            loading={busy || reloadBusy}
            onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
          />
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              style={{
                fontSize: "var(--text-xs)",
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(120,120,120,0.12)",
                color: "var(--text-dim)",
              }}
            >
              {t("i18n.disabled")}
            </span>
          ) : pkg.filtered && (
            <span
              style={{
                fontSize: "var(--text-xs)",
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(245,158,11,0.12)",
                color: "#d97706",
              }}
            >
              {t("i18n.filtered")}
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pkg.source}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => onAction("update", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy)}
          >
            {busyKey === `update:${key}` ? t("i18n.updating") : t("i18n.update")}
          </button>
          <button
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            style={buttonStyle(!sessionId || reloadBusy || busy)}
            title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
          >
            {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </button>
          <button
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy, true)}
          >
            {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
          </button>
        </div>
      </div>

      <div className={styles.summaryCard}>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.status")}</div>
        <div style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}>{pkg.status}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.version")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{versionSummary(pkg, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.package")}</div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {pkg.packageName ?? t("i18n.unknown")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.resources")}</div>
        <div style={{ color: "var(--text-muted)" }}>{resourceSummary(pkg, t)}</div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.installedPath")}</div>
        <div style={{ color: pkg.installedPath ? "var(--text-muted)" : "#ef4444", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}
        </div>
        <div style={{ color: "var(--text-dim)" }}>{t("i18n.cwd")}</div>
        <div style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
          {shortenPath(cwd)}
        </div>
      </div>

      {pkg.mcpCapabilities ? <McpCapabilities info={pkg.mcpCapabilities} /> : null}

      <section className={styles.section} aria-labelledby="plugin-package-contents-title">
        <div>
          <div className={styles.sectionTitle} id="plugin-package-contents-title">{t("plugins.packageContents")}</div>
          <div className={styles.sectionDescription}>{t("plugins.packageContentsDescription")}</div>
        </div>
        <ResourceList pkg={pkg} />
      </section>

      {actionMessage && (
        <div style={{ fontSize: "var(--text-sm)", color: "#16a34a" }}>
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div style={{ fontSize: "var(--text-sm)", color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {actionError}
        </div>
      )}
    </div>
  );
}
