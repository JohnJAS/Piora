"use client";

import { RuntimeErrorScreen } from "@/components/RuntimeErrorScreen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RuntimeErrorScreen error={error} reset={reset} />;
}
