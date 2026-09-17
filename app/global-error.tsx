"use client";
import { APP_DISPLAY_NAME } from "@/lib/branding";

import { RuntimeErrorScreen } from "@/components/RuntimeErrorScreen";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <title>{APP_DISPLAY_NAME}</title>
      </head>
      <body style={{ margin: 0 }}>
        <RuntimeErrorScreen error={error} reset={reset} />
      </body>
    </html>
  );
}
