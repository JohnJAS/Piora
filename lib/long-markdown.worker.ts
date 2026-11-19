import { parseLongMarkdown } from "./long-markdown";

self.addEventListener("message", ({ data }: MessageEvent<{ source: string; fileReferences: boolean }>) => {
  try {
    self.postMessage({ chunks: parseLongMarkdown(data.source, data.fileReferences) });
  } catch {
    self.postMessage({ error: true });
  }
});
