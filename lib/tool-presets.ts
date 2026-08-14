/** Pi's built-in coding tools are always enabled; Piora exposes no permission tiers. */
export const BUILTIN_AGENT_TOOLS: readonly string[] = [
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
];

/** The only Agent tools admitted by the cold-start device-control profile. */
export const DEVICE_CONTROL_AGENT_TOOLS: readonly string[] = ["harmony_device", "piora_goal"];

/**
 * Clamp a client-requested tool set to the process profile. Device-control
 * intentionally treats any non-empty UI preset as "enable device control" so
 * existing clients that send the coding preset cannot accidentally disable
 * the only safe tool. An explicit empty preset still disables every tool.
 */
export function resolveAgentToolsForRuntimeProfile(
  profile: "normal" | "device-control",
  requested: readonly string[] | undefined,
): string[] | undefined {
  if (profile === "normal") return requested ? [...requested] : undefined;
  return requested?.length === 0 ? [] : [...DEVICE_CONTROL_AGENT_TOOLS];
}
