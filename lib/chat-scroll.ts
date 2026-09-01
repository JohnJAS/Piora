export interface ScrollToBottomVisibilityInput {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  transientTailHeight?: number;
  threshold: number;
}

export interface ContentScrollMetricsInput {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  transientTailHeight?: number;
}

export interface ContentScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  maxScrollTop: number;
}

export interface LiveTailScrollLimitInput extends ContentScrollMetricsInput {
  pinnedScrollTop?: number | null;
}

/**
 * Normalize native scroll metrics to the height of actual conversation
 * content. The live-tail spacer may extend the browser's scroll range while
 * an agent is running, but controls must not expose that empty range.
 */
export function getContentScrollMetrics({
  scrollHeight,
  scrollTop,
  clientHeight,
  transientTailHeight = 0,
}: ContentScrollMetricsInput): ContentScrollMetrics {
  const contentScrollHeight = Math.max(0, scrollHeight - Math.max(0, transientTailHeight));
  const maxScrollTop = Math.max(0, contentScrollHeight - Math.max(0, clientHeight));
  return {
    scrollHeight: contentScrollHeight,
    scrollTop: Math.min(maxScrollTop, Math.max(0, scrollTop)),
    maxScrollTop,
  };
}

/**
 * Limit native scrolling while the live-tail spacer is mounted. A pinned
 * position may temporarily keep the latest user message near the top, but the
 * spacer itself must never create additional user-scrollable blank space.
 */
export function getLiveTailScrollLimit({
  scrollHeight,
  scrollTop,
  clientHeight,
  transientTailHeight = 0,
  pinnedScrollTop = null,
}: LiveTailScrollLimitInput): number {
  const metrics = getContentScrollMetrics({
    scrollHeight,
    scrollTop,
    clientHeight,
    transientTailHeight,
  });
  const nativeMaxScrollTop = Math.max(0, scrollHeight - Math.max(0, clientHeight));
  const preservedPinnedTop = pinnedScrollTop === null
    ? 0
    : Math.max(0, pinnedScrollTop);
  return Math.min(nativeMaxScrollTop, Math.max(metrics.maxScrollTop, preservedPinnedTop));
}

/**
 * The live chat adds a viewport-sized tail spacer so the latest user message
 * can be positioned near the top while an agent is working. That spacer is a
 * scrolling aid, not message content, and must not make the jump-to-bottom
 * control appear before the conversation itself fills the viewport.
 */
export function shouldShowScrollToBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
  transientTailHeight = 0,
  threshold,
}: ScrollToBottomVisibilityInput): boolean {
  const metrics = getContentScrollMetrics({
    scrollHeight,
    scrollTop,
    clientHeight,
    transientTailHeight,
  });
  const contentHeight = metrics.scrollHeight;
  const contentOverflowsViewport = contentHeight > clientHeight + 1;
  // Measure against the real content height, not scrollHeight, so the tail
  // spacer cannot keep the button visible after the user already reached the
  // bottom of the conversation.
  const distanceFromBottom = contentHeight - metrics.scrollTop - clientHeight;
  return contentOverflowsViewport && distanceFromBottom > threshold;
}
