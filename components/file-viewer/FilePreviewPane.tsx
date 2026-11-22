"use client";

import type { ComponentProps, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import { useI18n } from "@/hooks/useI18n";
import { resolveLocalFileHref } from "@/lib/file-links";
import { markdownPreviewRemarkPlugins } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "../MermaidBlock";
import { getFileApiUrl } from "./shared";

export function FilePreviewPane({
  isHtml,
  live,
  content,
  debouncedHtml,
  markdownPreview,
  markdownRehypePlugins,
  markdownDirectory,
  cwd,
  sourceSessionId,
  onOpenFile,
}: {
  isHtml: boolean;
  live: boolean;
  content: string;
  debouncedHtml: string;
  markdownPreview: string;
  markdownRehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"];
  markdownDirectory: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, options?: { line?: number; column?: number }) => void;
}) {
  const { t } = useI18n();

  if (isHtml) {
    return (
      <iframe
        srcDoc={live ? debouncedHtml : content}
        sandbox="allow-scripts"
        style={{ width: "100%", height: "100%", border: "none", background: "var(--file-panel-surface, var(--bg))" }}
        title={t("i18n.htmlPreview")}
      />
    );
  }

  return (
    <div
      className="markdown-body markdown-file-preview"
      style={{ padding: "24px 32px" }}
    >
      <ReactMarkdown
        remarkPlugins={markdownPreviewRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Render the code block directly — CodeBlock provides its own wrapping.
            // For non-mermaid blocks, pass through to default pre rendering.
            return <>{children}</>;
          },
          a({ href, children, ...props }) {
            delete props.node;
            const linkedFile = onOpenFile
              ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
              : null;
            if (!linkedFile || !onOpenFile) {
              return <a href={href} {...props}>{children}</a>;
            }

            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (event.defaultPrevented || event.button !== 0) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpenFile(linkedFile);
            };

            return <a href={href} {...props} onClick={handleClick}>{children}</a>;
          },
          img({ src, alt, ...props }) {
            delete props.node;
            const imagePath = typeof src === "string"
              ? resolveLocalFileHref(src, markdownDirectory, cwd ?? markdownDirectory)
              : null;
            const imageSrc = imagePath
              ? getFileApiUrl(imagePath, "read", sourceSessionId)
              : src;
            // Dynamic local paths are served directly by the file API.
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
          },
        }}
      >
        {markdownPreview}
      </ReactMarkdown>
    </div>
  );
}
