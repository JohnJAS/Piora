"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import { ModelProviderIcon } from "../ModelProviderIcon";
import {
  THINKING_LEVELS,
  THINKING_LEVEL_DESC_KEYS,
  THINKING_LEVEL_LABEL_KEYS,
  type ModelMenuSection,
  type ModelOption,
  type ThinkingLevel,
} from "./shared";

export interface ModelSettingsMenuProps {
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  isMobile: boolean;
  isStreaming: boolean;
  isCompacting?: boolean;
  isAutoModelSelection?: boolean;
  model?: { provider: string; modelId: string } | null;
  currentName: string | null;
  modelOptions: ModelOption[];
  modelsByProvider: { provider: string; options: ModelOption[] }[];
  showModelFilter: boolean;
  modelFilter: string;
  onModelFilterChange: (next: string) => void;
  dropdownOpen: boolean;
  dropdownRect: { top: number; left: number; width: number } | null;
  menuSection: ModelMenuSection;
  onToggleDropdown: (rect: { top: number; left: number; width: number }) => void;
  onCloseDropdown: () => void;
  onSelectSection: (section: ModelMenuSection) => void;
  onSelectModel: (provider: string, modelId: string, isActive: boolean) => void;
  activeThinkingLevel: ThinkingLevel;
  thinkingLevelLabel: string;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
}

export function ModelSettingsMenu({
  dropdownRef,
  panelRef,
  isMobile,
  isStreaming,
  isCompacting,
  isAutoModelSelection,
  model,
  currentName,
  modelOptions,
  modelsByProvider,
  showModelFilter,
  modelFilter,
  onModelFilterChange,
  dropdownOpen,
  dropdownRect,
  menuSection,
  onToggleDropdown,
  onCloseDropdown,
  onSelectSection,
  onSelectModel,
  activeThinkingLevel,
  thinkingLevelLabel,
  availableThinkingLevels,
  thinkingLevelMap,
  onThinkingLevelChange,
  onCompact,
  onAbortCompaction,
}: ModelSettingsMenuProps) {
  const { t } = useI18n();

  return (
    <div ref={dropdownRef} className="model-settings-control">
      <button
        type="button"
        className={`model-settings-trigger${dropdownOpen ? " is-open" : ""}`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onToggleDropdown({ top: rect.top, left: rect.left, width: rect.width });
        }}
        disabled={isStreaming}
        aria-haspopup="menu"
        aria-expanded={dropdownOpen}
        aria-label={currentName ? t("chat.selectCurrentModel", { model: currentName }) : t("chat.selectModel")}
        title={currentName ?? (modelOptions.length > 0 ? t("chat.selectModel") : t("chat.noModels"))}
      >
        <ModelProviderIcon
          provider={isAutoModelSelection ? undefined : model?.provider}
          modelId={isAutoModelSelection ? undefined : model?.modelId}
          modelName={currentName}
          size={14}
        />
        <span className="model-settings-trigger-label">
          {currentName ?? (modelOptions.length > 0 ? t("chat.selectModel") : t("chat.noModels"))}
        </span>
        {onThinkingLevelChange && !isAutoModelSelection ? (
          <span className="model-settings-trigger-reasoning">{thinkingLevelLabel}</span>
        ) : null}
      </button>
      {dropdownOpen && dropdownRect && (() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const bottom = viewportHeight - dropdownRect.top + 7;
        const maxH = Math.max(160, Math.min(dropdownRect.top - 12, viewportHeight * 0.68));
        const desktopPanelWidth = 230;
        const desktopPanelLeft = Math.min(
          Math.max(8, dropdownRect.left),
          Math.max(8, viewportWidth - desktopPanelWidth - 8),
        );
        const submenuLeftSpace = desktopPanelLeft - 8;
        const submenuRightSpace = viewportWidth - desktopPanelLeft - desktopPanelWidth - 8;
        const submenuOpensRight = submenuRightSpace >= submenuLeftSpace;
        const submenuWidth = Math.min(
          292,
          Math.max(160, (submenuOpensRight ? submenuRightSpace : submenuLeftSpace) - 7),
        );
        const panelPos: React.CSSProperties = isMobile
          ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
          : { left: desktopPanelLeft, right: "auto", width: desktopPanelWidth };
        const visibleSection = isMobile ? menuSection : null;
        const selectableThinkingLevels = THINKING_LEVELS.filter((level) => (
          !availableThinkingLevels || level === "auto" || availableThinkingLevels.includes(level)
        ));

        const renderModelChoices = () => (
          <>
            {showModelFilter ? (
              <div className="model-settings-search">
                <AliIcon name="search" size={13} />
                <input
                  value={modelFilter}
                  onChange={(event) => onModelFilterChange(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}
            <div className="model-settings-list">
              {modelsByProvider.length === 0 ? (
                <div className="model-settings-empty">
                  {modelFilter.trim() ? t("chat.noMatchingModels") : t("chat.noModels")}
                </div>
              ) : modelsByProvider.map((group) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 ? <div className="model-settings-provider">{group.provider}</div> : null}
                  {group.options.map((option) => {
                    const isActive = !isAutoModelSelection && option.modelId === model?.modelId && option.provider === model?.provider;
                    return (
                      <button
                        key={`${option.provider}:${option.modelId}`}
                        type="button"
                        className={`model-settings-choice${isActive ? " is-active" : ""}`}
                        onClick={() => onSelectModel(option.provider, option.modelId, isActive)}
                        role="menuitemradio"
                        aria-checked={isActive}
                      >
                        <ModelProviderIcon
                          className="model-settings-choice-icon"
                          provider={option.provider}
                          modelId={option.modelId}
                          modelName={option.name}
                          size={15}
                        />
                        <span className="model-settings-choice-label">{option.name}</span>
                        {isActive ? <AliIcon name="check" size={11} /> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        );

        const renderReasoningChoices = () => (
          <div className="model-settings-list">
            {selectableThinkingLevels.map((level) => {
              const isActive = activeThinkingLevel === level;
              const mappedValue = level !== "auto" && thinkingLevelMap ? thinkingLevelMap[level] : undefined;
              return (
                <button
                  key={level}
                  type="button"
                  className={`model-settings-choice model-settings-reasoning-choice${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    onCloseDropdown();
                    if (!isActive) onThinkingLevelChange?.(level);
                  }}
                  role="menuitemradio"
                  aria-checked={isActive}
                  title={t(THINKING_LEVEL_DESC_KEYS[level])}
                >
                  <span>{t(THINKING_LEVEL_LABEL_KEYS[level])}</span>
                  {mappedValue != null && mappedValue !== level ? <small>{mappedValue}</small> : null}
                  {isActive ? <AliIcon name="check" size={11} /> : null}
                </button>
              );
            })}
          </div>
        );

        return createPortal(
          <div
            ref={panelRef}
            className="model-settings-popover"
            style={{ position: "fixed", bottom, maxHeight: maxH, ...panelPos }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              if (menuSection) onSelectSection(null);
              else onCloseDropdown();
            }}
          >
            {visibleSection ? (
              <div className="model-settings-subview" role="menu">
                <button type="button" className="model-settings-back" onClick={() => { onSelectSection(null); onModelFilterChange(""); }}>
                  <AliIcon name="arrowleft" size={13} />
                  <span>{visibleSection === "models" ? t("i18n.model") : t("chat.reasoningEffort")}</span>
                </button>
                {visibleSection === "models" ? renderModelChoices() : renderReasoningChoices()}
              </div>
            ) : (
              <div className="model-settings-root" role="menu">
                <button
                  type="button"
                  className={`model-settings-row${menuSection === "models" ? " is-active" : ""}`}
                  onMouseEnter={() => { if (!isMobile) onSelectSection("models"); }}
                  onClick={() => onSelectSection("models")}
                  role="menuitem"
                >
                  <span className="model-settings-row-label">{t("i18n.model")}</span>
                  <span className="model-settings-row-value">{currentName ?? t("chat.selectModel")}</span>
                </button>
                {onThinkingLevelChange && !isAutoModelSelection ? (
                  <button
                    type="button"
                    className={`model-settings-row${menuSection === "reasoning" ? " is-active" : ""}`}
                    onMouseEnter={() => { if (!isMobile) onSelectSection("reasoning"); }}
                    onClick={() => onSelectSection("reasoning")}
                    role="menuitem"
                  >
                    <span className="model-settings-row-label">{t("chat.reasoningEffort")}</span>
                    <span className="model-settings-row-value">{thinkingLevelLabel}</span>
                  </button>
                ) : null}
                {!isStreaming && onCompact ? (
                  <div className="model-settings-footer">
                    {isCompacting ? (
                      <div className="model-settings-compaction" role="status" aria-live="polite">
                        <span className="model-settings-compaction-spinner" aria-hidden="true" />
                        <span className="model-settings-compaction-label">{t("chat.compacting")}</span>
                        <button
                          type="button"
                          className="model-settings-compaction-stop"
                          onClick={onAbortCompaction}
                          title={t("chat.stopCompaction")}
                          aria-label={t("chat.stopCompaction")}
                        >
                          <AliIcon name="stop" size={10} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="model-settings-row"
                        onClick={() => {
                          onCloseDropdown();
                          onCompact();
                        }}
                        title={t("chat.compactContext")}
                      >
                        <span>{t("chat.compactContext")}</span>
                        <AliIcon name="shrink" size={12} />
                      </button>
                    )}
                  </div>
                ) : null}
                {!isMobile && menuSection ? (
                  <div
                    className="model-settings-submenu"
                    role="menu"
                    style={{
                      maxHeight: maxH,
                      width: submenuWidth,
                      ...(submenuOpensRight
                        ? { left: "calc(100% + 7px)", right: "auto" }
                        : { right: "calc(100% + 7px)", left: "auto" }),
                    }}
                  >
                    <div className="model-settings-submenu-title">
                      {menuSection === "models" ? t("i18n.model") : t("chat.reasoningEffort")}
                    </div>
                    {menuSection === "models" ? renderModelChoices() : renderReasoningChoices()}
                  </div>
                ) : null}
              </div>
            )}
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
