"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AgentMessage, TextContent, UserMessage } from "@/lib/types";
import styles from "./ChatMinimap.module.css";

interface Props {
  messages: AgentMessage[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
}

const MAX_NODE_GAP = 44;
const MINIMAP_PADDING = 16;
const PREVIEW_HIDE_DELAY = 180;
const NAVIGATION_ACTIVE_LOCK_MS = 1400;

interface TurnInfo {
  preview: string;
  scrollTop: number | null;
}

interface NodeInfo {
  topRatio: number;
  targetTurn: TurnInfo;
  index: number;
}

interface NodeLayout {
  nodes: NodeInfo[];
  gap: number;
}

function getUserPreview(message: UserMessage): string {
  const content = typeof message.content === "string"
    ? message.content
    : message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join(" ");
  return content.replace(/\s+/g, " ").trim();
}

function createTurnNodes(turns: TurnInfo[]): NodeInfo[] {
  return turns.map((turn, index) => ({
    topRatio: 0,
    targetTurn: turn,
    index,
  }));
}

function layoutNodes(allNodes: NodeInfo[], minimapHeight: number): NodeLayout {
  if (allNodes.length === 0) return { nodes: [], gap: MAX_NODE_GAP };

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.max(0, height - MINIMAP_PADDING * 2);
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: MINIMAP_PADDING / height }],
      gap: MAX_NODE_GAP,
    };
  }

  const gap = Math.min(MAX_NODE_GAP, usableHeight / (allNodes.length - 1));
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (MINIMAP_PADDING + index * gap) / height,
    })),
    gap,
  };
}

export function ChatMinimap({
  messages,
  scrollContainer,
  messageRefs,
  onRevealHistory,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [previewOpen, setPreviewOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewListRef = useRef<HTMLDivElement>(null);
  const previewItemRefs = useRef(new Map<number, HTMLButtonElement>());
  const allNodesRef = useRef<NodeInfo[]>([]);
  const messagesRef = useRef(messages);
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<number | null>(null);

  messagesRef.current = messages;

  const nodeLayout = useMemo(
    () => layoutNodes(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { nodes: positionedNodes, gap: nodeGap } = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.targetTurn.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }

    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.targetTurn.scrollTop ?? 0) - focusTop)
        < Math.abs((bestNode.targetTurn.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const currentNodes = allNodesRef.current;
    const hasUserMessages = messagesRef.current.some((message) => message.role === "user");
    setVisible(hasUserMessages && scrollEl.scrollHeight - scrollEl.clientHeight > 20);
    syncActiveNode(scrollEl, currentNodes);
  }, [scrollContainer, syncActiveNode]);

  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const turns: TurnInfo[] = [];
      let refIndex = 0;

      for (const message of messagesRef.current) {
        if (message.role !== "user" && message.role !== "assistant") continue;
        const element = refs?.[refIndex] ?? null;
        refIndex += 1;
        if (message.role !== "user") continue;

        const elementRect = element?.getBoundingClientRect();
        turns.push({
          preview: getUserPreview(message as UserMessage),
          scrollTop: elementRect
            ? elementRect.top - containerRect.top + scrollEl.scrollTop
            : null,
        });
      }

      const nextNodes = createTurnNodes(turns);
      setMinimapHeight(minimapEl.clientHeight);
      allNodesRef.current = nextNodes;
      setAllNodes(nextNodes);
      setVisible(nextNodes.length > 0 && scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);

      const pendingIndex = pendingNavigationRef.current;
      const pendingNode = pendingIndex === null ? null : nextNodes[pendingIndex];
      if (pendingNode?.targetTurn.scrollTop !== null && pendingNode?.targetTurn.scrollTop !== undefined) {
        pendingNavigationRef.current = null;
        lockActiveNode(pendingNode.index);
        scrollEl.scrollTo({
          top: Math.max(0, pendingNode.targetTurn.scrollTop - scrollEl.clientHeight * 0.3),
          behavior: "smooth",
        });
      }
    }, 120);
  }, [lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

  useEffect(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", updateScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const resizeObserver = new ResizeObserver(syncLayout);
    resizeObserver.observe(scrollEl);
    if (scrollEl.firstElementChild) resizeObserver.observe(scrollEl.firstElementChild);
    syncLayout();
    return () => {
      resizeObserver.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior = "smooth") => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);
    if (node.targetTurn.scrollTop === null) {
      pendingNavigationRef.current = node.index;
      onRevealHistory();
      return;
    }
    scrollEl.scrollTo({
      top: Math.max(0, node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3),
      behavior,
    });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const showPreview = useCallback(() => {
    cancelPreviewHide();
    setPreviewOpen(true);
  }, [cancelPreviewHide]);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setPreviewOpen(false);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    schedulePreviewHide();
  }, [schedulePreviewHide]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  useEffect(() => {
    if (!previewOpen || activeIndex === null) return;
    const previewList = previewListRef.current;
    const activeItem = previewItemRefs.current.get(activeIndex);
    if (!previewList || !activeItem) return;
    const targetTop = activeItem.offsetTop - (previewList.clientHeight - activeItem.offsetHeight) / 2;
    previewList.scrollTop = Math.max(0, targetTop);
  }, [activeIndex, previewOpen]);

  if (!visible) return null;

  const lastNodeTop = positionedNodes.length > 0
    ? positionedNodes[positionedNodes.length - 1].topRatio * minimapHeight
    : MINIMAP_PADDING;
  const railHeight = Math.max(1, lastNodeTop - MINIMAP_PADDING);

  return (
    <div
      ref={containerRef}
      className={styles.root}
      data-testid="chat-timeline"
      onMouseEnter={showPreview}
      onMouseLeave={schedulePreviewHide}
      onFocusCapture={showPreview}
      onBlurCapture={handleBlurCapture}
    >
      <div
        className={styles.track}
        style={{ top: MINIMAP_PADDING, height: railHeight }}
        aria-hidden="true"
      />

      {positionedNodes.map((node) => {
        const isActive = activeIndex === node.index;
        const previewText = node.targetTurn.preview || t("chat.timelineAttachmentOnly");
        return (
          <button
            key={node.index}
            type="button"
            className={styles.node}
            data-minimap-node-index={node.index}
            data-minimap-node-active={isActive ? "true" : undefined}
            aria-current={isActive ? "true" : undefined}
            aria-label={t("chat.timelineJump", {
              index: node.index + 1,
              text: previewText,
            })}
            title={previewText}
            onClick={() => scrollToNode(node)}
            style={{
              top: `${node.topRatio * 100}%`,
              height: Math.max(14, nodeGap),
            }}
          >
            <span className={styles.dot} aria-hidden="true" />
          </button>
        );
      })}

      {previewOpen ? (
        <div className={styles.preview} data-minimap-preview-box="">
          <div className={styles.previewHeader}>
            <span className={styles.previewTitle}>{t("chat.timeline")}</span>
            <span className={styles.previewCount}>{t("chat.timelineCount", { count: allNodes.length })}</span>
          </div>
          <div ref={previewListRef} className={styles.previewList}>
            {allNodes.map((node) => {
              const isActive = activeIndex === node.index;
              const previewText = node.targetTurn.preview || t("chat.timelineAttachmentOnly");
              return (
                <button
                  key={node.index}
                  ref={(element) => {
                    if (element) previewItemRefs.current.set(node.index, element);
                    else previewItemRefs.current.delete(node.index);
                  }}
                  type="button"
                  className={styles.previewItem}
                  data-minimap-preview-user={node.index}
                  data-active={isActive ? "true" : undefined}
                  aria-current={isActive ? "true" : undefined}
                  title={previewText}
                  onClick={() => scrollToNode(node)}
                >
                  <span className={styles.previewNumber} aria-hidden="true">
                    {String(node.index + 1).padStart(2, "0")}
                  </span>
                  <span className={styles.previewText}>{previewText}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, index) => refs.current[index] ?? null);
  return refs;
}
