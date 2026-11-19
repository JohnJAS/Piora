import type { Root, RootContent } from "hast";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkFileReferences } from "./file-references";
import { markdownHasMath, markdownHasRawHtml, markdownRemarkPlugins, markdownRehypePlugins, normalizeDisplayMath, normalizeTextHighlights } from "./markdown";
import { rehypeAssistantEmphasis } from "./markdown-emphasis";

const CHUNK_NODES = 32;

export function parseLongMarkdown(source: string, fileReferences: boolean): RootContent[][] {
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
  const chunks: RootContent[][] = [];
  for (let start = 0; start < tree.children.length; start += CHUNK_NODES) {
    chunks.push(tree.children.slice(start, start + CHUNK_NODES));
  }
  return chunks;
}
