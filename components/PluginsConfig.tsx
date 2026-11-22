"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import { CapabilityPrimer } from "./CapabilityPrimer";
import { NativeMcpConfig } from "./NativeMcpConfig";
import styles from "./PluginsConfig.module.css";
import {
  AddPluginPanel,
  buttonStyle,
  findInstalledPackage,
  PackageDetail,
  packageKey,
  resourceSummary,
  shortenPath,
  statusColor,
  versionSummary,
  type PluginAction,
  type PluginScope,
} from "./plugins-config/PluginDetails";

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  onOpenProjectTools,
  embedded = false,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  onOpenProjectTools?: (server: { name: string; toolNames: string[] }) => void;
  embedded?: boolean;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [data, setData] = useState<PluginsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [nativeMcpMode, setNativeMcpMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, !embedded, { onEscape: onClose });

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`);
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      setAddMode((current) => next.packages.length === 0 || current);
      setSelected((current) => {
        if (current && next.packages.some((pkg) => packageKey(pkg) === current)) return current;
        return next.packages[0] ? packageKey(next.packages[0]) : null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      if (action === "remove") {
        setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
        if (next.packages.length === 0) setAddMode(true);
        setActionMessage("Package removed.");
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: "Package installed.",
          update: "Package updated.",
          disable: "Package disabled.",
          enable: "Package enabled.",
        };
        setActionMessage(messages[action]);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd]);

  const installPlugin = useCallback(async () => {
    const source = installSource.trim();
    if (!source) return;
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string; code?: string };
      if (next.code === "desktop-extension-package") throw new Error(t("desktopExtensions.useDesktopSettings"));
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      setData(next);
      const installed = findInstalledPackage(next.packages, source, installScope);
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage("Package installed.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource, t]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;

  return (
    <div
      style={{
        position: embedded ? "relative" : "fixed",
        inset: embedded ? undefined : 0,
        zIndex: embedded ? undefined : 1000,
        width: "100%",
        height: "100%",
        minHeight: 0,
        background: embedded ? "var(--settings-page-background, var(--bg))" : "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (!embedded && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={embedded ? undefined : "app-shell-dialog"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-label={t("common.plugins")}
        style={{
          width: embedded ? "100%" : isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: embedded ? "none" : "calc(100vw - 16px)",
          height: embedded ? "100%" : isMobile ? "calc(100dvh - 16px)" : "76vh",
          maxHeight: embedded ? "none" : "calc(100dvh - 16px)",
          background: embedded ? "var(--settings-page-background, var(--bg))" : "var(--bg)",
          border: embedded ? "none" : "1px solid var(--border)",
          borderRadius: embedded ? 0 : 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: embedded ? "none" : "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: embedded ? "28px 32px 18px" : "12px 18px",
            borderBottom: embedded ? "none" : "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: embedded ? "calc(var(--text-lg) * 1.28)" : "var(--text-md)", fontWeight: embedded ? 650 : 700, color: "var(--text)" }}>
              {t("common.plugins")}
            </span>
            <code
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          {!embedded && (
            <button
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
              style={{
                display: "inline-flex",
                width: 28,
                height: 28,
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                borderRadius: "var(--radius-control)",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <AliIcon name="close" size={16} />
            </button>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          <div
            style={{
              width: isMobile ? "100%" : embedded ? 258 : 245,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: embedded ? "var(--settings-panel-background, color-mix(in srgb, var(--bg-panel) 60%, var(--bg)))" : "var(--bg-panel)",
            }}
          >
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              <button
                type="button"
                aria-pressed={nativeMcpMode}
                onClick={() => { setNativeMcpMode(true); setAddMode(false); }}
                style={{ padding: "10px 8px", width: "100%", textAlign: "left", color: "var(--text)", background: nativeMcpMode ? "var(--bg-selected)" : "transparent", border: "none" }}
              >
                {t("nativeMcp.title")}
              </button>
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                  {t("i18n.loading")}
                </div>
              ) : error ? (
                <div style={{ padding: "10px 8px", fontSize: "var(--text-xs)", color: "#ef4444" }}>
                  {error}
                </div>
              ) : packages.length === 0 ? (
                <div style={{ padding: "10px 8px", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                  {t("i18n.noPlugins")}
                </div>
              ) : (
                groupedPackages.map((group) => (
                  <div key={group.scope} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        padding: "4px 8px 3px",
                        fontSize: "var(--text-xs)",
                        fontWeight: 600,
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                      }}
                    >
                      {group.scope}
                    </div>
                    {group.packages.map((pkg) => {
                      const key = packageKey(pkg);
                      const isSelected = !nativeMcpMode && !addMode && selected === key;
                      return (
                        <div
                          key={key}
                          onClick={() => {
                            setSelected(key);
                            setNativeMcpMode(false);
                            setAddMode(false);
                            setActionError(null);
                            setActionMessage(null);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                            padding: "8px 8px",
                            borderRadius: "var(--radius-control)",
                            cursor: "pointer",
                            background: isSelected ? "var(--bg-selected)" : "none",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "none";
                          }}
                        >
                          <span className={styles.packageIcon} style={{ color: statusColor(pkg.status) }} aria-hidden="true">
                            <AliIcon name="package" size={16} />
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                fontSize: "var(--text-sm)",
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--text)",
                                fontFamily: "var(--font-mono)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {pkg.source}
                            </div>
                            <div
                              style={{
                                fontSize: "var(--text-xs)",
                                color: "var(--text-dim)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                marginTop: 2,
                              }}
                            >
                              {resourceSummary(pkg, t)}
                            </div>
                            {(pkg.version || pkg.configuredVersion) && (
                              <div
                                style={{
                                  fontSize: "var(--text-xs)",
                                  color: "var(--text-dim)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginTop: 2,
                                }}
                              >
                                {versionSummary(pkg, t)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "8px 6px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => {
                  setNativeMcpMode(false);
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 8px",
                  borderRadius: "var(--radius-control)",
                  border: "none",
                  width: "100%",
                  cursor: "pointer",
                  background: addMode ? "var(--bg-selected)" : "none",
                  color: addMode ? "var(--accent)" : "var(--text-dim)",
                  fontSize: "var(--text-sm)",
                }}
                onMouseEnter={(e) => {
                  if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!addMode) e.currentTarget.style.background = "none";
                }}
              >
                <AliIcon name="plus" size={13} />
                {t("i18n.addPlugin")}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: embedded ? "20px 32px 36px" : 20 }}>
            {!embedded ? <CapabilityPrimer current="plugin" /> : null}
            {nativeMcpMode ? (
              <NativeMcpConfig key={`${cwd}:${sessionId ?? ""}`} cwd={cwd} sessionId={sessionId} onReloaded={onReloaded} onOpenProjectTools={onOpenProjectTools} />
            ) : addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: "var(--text-base)",
                }}
              >
                {t("i18n.selectPackage")}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: embedded ? "12px 32px" : "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1, fontSize: "var(--text-xs)", color: "var(--text-dim)", overflow: "hidden" }}>
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
                style={{ color: data.diagnostics.some((d) => d.type === "error") ? "#ef4444" : "#d97706" }}
              >
                {data.diagnostics.length} diagnostic{data.diagnostics.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>
                {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes` : ""}
              </span>
            )}
          </div>
          <button onClick={() => void loadPlugins()} disabled={loading || busyKey !== null} style={buttonStyle(loading || busyKey !== null)}>
            {t("i18n.refresh")}
          </button>
          {!embedded && (
            <button onClick={onClose} style={buttonStyle(false)}>
              {t("i18n.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
