export interface ScrollToBottomVisibilityInput {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
  transientTailHeight?: number;
  threshold: number;
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
  const contentHeight = Math.max(0, scrollHeight - Math.max(0, transientTailHeight));
  const contentOverflowsViewport = contentHeight > clientHeight + 1;
  // Measure against the real content height, not scrollHeight, so the tail
  // spacer cannot keep the button visible after the user already reached the
  // bottom of the conversation.
  const distanceFromBottom = contentHeight - scrollTop - clientHeight;
  return contentOverflowsViewport && distanceFromBottom > threshold;
}
