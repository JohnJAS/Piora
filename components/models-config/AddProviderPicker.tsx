"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { prioritizeProvider } from "@/lib/model-policy";
import { AliIcon } from "../AliIcon";
import { ModelProviderIcon } from "../ModelProviderIcon";
import type { ApiKeyProvider, OAuthProvider } from "./types";

export interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  hiddenProviders: { id: string; label: string }[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onRestoreProvider: (id: string) => Promise<boolean>;
  onAddCustom: () => void;
  onClose: () => void;
}

export function AddProviderPicker({
  oauthProviders, apiKeyProviders, hiddenProviders,
  onSelectOAuth, onSelectApiKey, onRestoreProvider, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const [restoringProvider, setRestoringProvider] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState(false);
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();
  const hiddenIds = new Set(hiddenProviders.map(provider => provider.id));

  const availableOAuth = prioritizeProvider(
    oauthProviders.filter((p) => !p.loggedIn && !hiddenIds.has(p.id) && (!q || p.name.toLowerCase().includes(q))),
    (provider) => provider.id,
  );
  const availableApiKey = prioritizeProvider(
    apiKeyProviders.filter((p) => !p.configured && !hiddenIds.has(p.id) && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))),
    (provider) => provider.id,
  );
  const visibleHiddenProviders = prioritizeProvider(
    hiddenProviders.filter((provider) => !q || provider.label.toLowerCase().includes(q) || provider.id.toLowerCase().includes(q)),
    (provider) => provider.id,
  );
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = visibleHiddenProviders.length + availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-control)",
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };

  return (
    <div
      className="app-shell-dialog-backdrop"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="app-shell-dialog" style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <AliIcon name="search" size={13} style={{ color: "var(--text-dim)" }} />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder={t("i18n.searchProviders")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: "var(--text-base)", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: "var(--text-sm)", color: "var(--text-dim)", textAlign: "center" }}>{t("i18n.noProviders")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {visibleHiddenProviders.length > 0 && (
                <div style={{ gridColumn: "1 / -1", fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  {t("models.hiddenProviders")}
                </div>
              )}
              {visibleHiddenProviders.map((provider) => (
                <button
                  key={`hidden:${provider.id}`}
                  type="button"
                  disabled={restoringProvider !== null}
                  onClick={async () => {
                    setRestoreError(false);
                    setRestoringProvider(provider.id);
                    const restored = await onRestoreProvider(provider.id);
                    setRestoringProvider(null);
                    if (restored) onClose();
                    else setRestoreError(true);
                  }}
                  style={{ ...cardStyle, opacity: restoringProvider && restoringProvider !== provider.id ? 0.55 : 1 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{provider.label}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2 }}>
                      {restoringProvider === provider.id ? t("models.restoringProvider") : t("models.restoreProvider")}
                    </div>
                  </div>
                  <ModelProviderIcon provider={provider.id} size={28} />
                </button>
              ))}
              {restoreError && (
                <div role="alert" style={{ gridColumn: "1 / -1", padding: "8px 10px", borderRadius: "var(--radius-control)", background: "rgba(239,68,68,0.08)", color: "#dc2626", fontSize: "var(--text-xs)" }}>
                  {t("models.restoreProviderFailed")}
                </div>
              )}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: visibleHiddenProviders.length > 0 ? 6 : 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("models.form.secretKey")}</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2 }}>{t("models.form.count", { count: p.modelCount })}</div>
                  </div>
                  <ModelProviderIcon provider={p.id} size={28} />
                </button>
              ))}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableApiKey.length > 0 ? 6 : 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("i18n.subscriptions")}</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2 }}>{t("models.login.oauth")}</div>
                  </div>
                  <ModelProviderIcon provider={p.id} size={28} />
                </button>
              ))}

              {showCustom && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableApiKey.length > 0 || availableOAuth.length > 0 ? 6 : 0, fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{t("i18n.custom")}</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("models.form.compatible")}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2 }}>{t("i18n.customEndpoint")}</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: "var(--radius-control)", background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <AliIcon name="plus" size={13} style={{ color: "var(--text-dim)" }} />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
