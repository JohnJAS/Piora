import type { Root } from "hast";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkFileReferences } from "./file-references";
import { markdownHasMath, markdownHasRawHtml, markdownRemarkPlugins, markdownRehypePlugins, normalizeDisplayMath, normalizeTextHighlights } from "./markdown";
import { rehypeAssistantEmphasis } from "./markdown-emphasis";

const CHUNK_NODES = 32;

export interface MarkdownSection {
  tree: string;
  preview: string;
}

export function parseLongMarkdown(source: string, fileReferences: boolean): MarkdownSection[] {
  const text = normalizeTextHighlights(normalizeDisplayMath(source));
  const processor = unified()
    .use(remarkParse)
    .use(markdownRemarkPlugins);
  if (fileReferences) processor.use(remarkFileReferences);
  const html = processor.use(remarkRehype, { allowDangerousHtml: true });
  if (markdownHasRawHtml(text)) html.use(rehypeRaw);
  html.use(markdownRehypePlugins);
  if (markdownHasMath(text)) html.use(rehypeKatex, { throwOnError: false, strict: false });
  html.use(rehypeAssistantEmphasis);
  const tree = html.runSync(html.parse(text)) as Root;

  // Keep one document's references and footnotes together through parsing.
  // The renderer can then yield between small groups of top-level nodes.
  const chunks: MarkdownSection[] = [];
  let end = text.length;
  for (let start = Math.floor((tree.children.length - 1) / CHUNK_NODES) * CHUNK_NODES; start >= 0; start -= CHUNK_NODES) {
    const nodes = tree.children.slice(start, start + CHUNK_NODES);
    const offset = start === 0 ? 0 : Math.min(end, nodes.find(node => node.position)?.position?.start.offset ?? end);
    // Only decode a small group on the UI thread. Position objects are for
    // parsing and need not be cloned across threads or retained in the DOM.
    chunks.push({ tree: JSON.stringify(nodes, (key, value) => key === "position" ? undefined : value), preview: text.slice(offset, end) });
    end = offset;
  }
  return chunks.reverse();
}
