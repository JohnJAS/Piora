/** Show a stable completed line from the newest paragraph while tokens arrive. */
export function thinkingPreview(text: string, streaming = false): string {
  const paragraphs = text.trimStart().split(/\r?\n\s*\r?\n/);
  const firstLine = (paragraph: string) => paragraph.split(/\r?\n/, 1)[0].trim();
  const candidates = streaming ? paragraphs.filter((paragraph, index) => index < paragraphs.length - 1 || paragraph.includes("\n")) : paragraphs;
  const line = streaming ? candidates.at(-1) : candidates[0];
  return (line ? firstLine(line) : "").replace(/\*\*|^#{1,6}\s+/g, "").slice(0, 160);
}
