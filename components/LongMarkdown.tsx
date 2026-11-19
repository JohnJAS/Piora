"use client";

import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { RootContent } from "hast";
import ReactMarkdown, { type Components, type Options } from "react-markdown";

const STREAM_INTERVAL_MS = 100;

interface ParsedMarkdown {
  source: string;
  fileReferences: boolean;
  chunks: RootContent[][];
}

const MarkdownChunk = memo(function MarkdownChunk({ nodes, components }: { nodes: RootContent[]; components: Components }) {
  const plugins: Options["rehypePlugins"] = useMemo(() => [
    () => () => ({ type: "root", children: nodes }),
  ], [nodes]);
  // Reuse react-markdown's URL policy and component mappings on worker output.
  return <ReactMarkdown rehypePlugins={plugins} components={components} />;
});

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
    worker.onmessage = ({ data }: MessageEvent<{ chunks?: RootContent[][] }>) => {
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
      worker.terminate();
    };
  }, [fileReferences]);

  const rendered = parsed && parsed.fileReferences === fileReferences && source.startsWith(parsed.source) ? parsed : null;
  const tail = rendered ? source.slice(rendered.source.length) : source;
  return <>
    {rendered?.chunks.map((nodes, index) => <MarkdownChunk key={index} nodes={nodes} components={components} />)}
    {tail ? <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{tail}</div> : null}
  </>;
}
