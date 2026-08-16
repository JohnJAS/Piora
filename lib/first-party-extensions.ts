import { resolve } from "node:path";

export interface FirstPartyExtensionDescriptor {
  id: string;
  fileName: string;
  name: string;
  description: string;
  profiles: readonly ("normal" | "device-control")[];
  requiredInDeviceControl?: boolean;
}

export const FIRST_PARTY_EXTENSIONS: readonly FirstPartyExtensionDescriptor[] = [
  {
    id: "piora:browser",
    fileName: "piora-browser.ts",
    name: "Piora Browser",
    description: "Private headless browser and page inspection tools.",
    profiles: ["normal"],
  },
  {
    id: "piora:harmony",
    fileName: "piora-harmony.ts",
    name: "Piora Harmony",
    description: "Approved OpenHarmony device inspection and control tools.",
    profiles: ["normal", "device-control"],
    requiredInDeviceControl: true,
  },
  {
    id: "piora:goal",
    fileName: "piora-goal.ts",
    name: "Piora Target Mode",
    description: "Persistent target lifecycle, progress, evidence, and continuation tools.",
    profiles: ["normal", "device-control"],
  },
  {
    id: "piora:plan",
    fileName: "piora-plan.ts",
    name: "Piora Plan Mode",
    description: "One-shot read-only planning instructions and runtime status.",
    profiles: ["normal", "device-control"],
  },
  {
    id: "piora:room",
    fileName: "piora-room.ts",
    name: "Piora Rooms",
    description: "Multi-agent room messaging, task coordination, and shared artifacts.",
    profiles: ["normal"],
  },
] as const;

export function firstPartyExtensionPath(descriptor: FirstPartyExtensionDescriptor): string {
  return resolve(process.cwd(), "extensions", descriptor.fileName);
}

export function getFirstPartyExtensionByPath(path: string): FirstPartyExtensionDescriptor | undefined {
  const candidate = resolve(path).replaceAll("\\", "/");
  return FIRST_PARTY_EXTENSIONS.find((descriptor) => {
    const expected = firstPartyExtensionPath(descriptor).replaceAll("\\", "/");
    return process.platform === "win32"
      ? candidate.toLocaleLowerCase() === expected.toLocaleLowerCase()
      : candidate === expected;
  });
}
