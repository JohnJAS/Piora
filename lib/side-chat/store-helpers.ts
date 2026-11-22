export function readRuntimeHomeOrFallback(cwd: string | undefined): string {
  const trimmed = cwd?.trim();
  return trimmed || process.cwd();
}
