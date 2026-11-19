"use client";

import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { RootContent } from "hast";
import type { MarkdownSection } from "@/lib/long-markdown";
import ReactMarkdown, { type Components, type Options } from "react-markdown";

const STREAM_INTERVAL_MS = 100;

interface ParsedMarkdown {
  source: string;
  fileReferences: boolean;
  chunks: MarkdownSection[];
}

const MarkdownChunk = memo(function MarkdownChunk({ tree, components }: { tree: string; components: Components }) {
  const plugins: Options["rehypePlugins"] = useMemo(() => {
    const nodes: RootContent[] = JSON.parse(tree);
    return [() => () => ({ type: "root", children: nodes })];
  }, [tree]);
  // Reuse react-markdown's URL policy and component mappings on worker output.
  return <ReactMarkdown rehypePlugins={plugins} components={components} />;
});

const SECTIONS_PER_FRAME = 4;
const plainTextStyle = { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;

function FormattedSections({ chunks, components }: { chunks: MarkdownSection[]; components: Components }) {
  const [count, setCount] = useState(SECTIONS_PER_FRAME);
  useEffect(() => {
    if (count >= chunks.length) return;
    const frame = requestAnimationFrame(() => startTransition(() => setCount(previous => previous + SECTIONS_PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [chunks.length, count]);
  if (chunks.length === 1) return <MarkdownChunk tree={chunks[0].tree} components={components} />;
  return chunks.map(({ tree, preview }, index) => (
    <div key={index} className="long-markdown-section">
      {index < count ? <MarkdownChunk tree={tree} components={components} /> : <div style={plainTextStyle}>{preview}</div>}
    </div>
  ));
}

export function LongMarkdown({ source, fileReferences, components }: {
  source: string; fileReferences: boolean; components: Components;
}) {
  const latest = useRef(source);
  const request = useRef<(() => void) | null>(null);
  const [parsed, setParsed] = useState<ParsedMarkdown | null>(null);

  useEffect(() => {
    latest.current = source;
    request.current?.();
  }, [source]);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../lib/long-markdown.worker.ts", import.meta.url), { type: "module", name: "piora-markdown" });
    } catch {
      return;
    }
    let inFlight: string | null = null;
    let sent: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (inFlight !== null || timer !== undefined || sent === latest.current) return;
      timer = setTimeout(() => {
        timer = undefined;
        inFlight = sent = latest.current;
        worker.postMessage({ source: inFlight, fileReferences });
      }, sent === null ? 0 : STREAM_INTERVAL_MS);
    };
    worker.onmessage = ({ data }: MessageEvent<{ chunks?: MarkdownSection[] }>) => {
      const source = inFlight;
      inFlight = null;
      if (source !== null && data.chunks) {
        const chunks = data.chunks;
        startTransition(() => setParsed({ source, fileReferences, chunks }));
      }
      schedule();
    };
    request.current = schedule;
    schedule();
    return () => {
      request.current = null;
      clearTimeout(timer);
      worker.onmessage = null;
      // A chunk fetch can finish with an error after navigation cancels it.
      worker.onerror = event => event.preventDefault();
      worker.terminate();
    };
  }, [fileReferences]);

  const rendered = parsed && parsed.fileReferences === fileReferences && source.startsWith(parsed.source) ? parsed : null;
  const tail = rendered ? source.slice(rendered.source.length) : source;
  return <>
    {rendered && <FormattedSections chunks={rendered.chunks} components={components} />}
    {tail ? <div style={plainTextStyle}>{tail}</div> : null}
  </>;
}
