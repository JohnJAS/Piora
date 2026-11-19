import { CORDIS_HOST_API, CORDIS_VERSION, type CordisProfile, type CordisRelease } from "./cordis-extension-contract.js";

const adapter = "piora-community-panel";
// Only these package versions and browser assets run in the separate panel.
// The original DSH server entry and bundle patch are never loaded.
function profile(
  manifest: Omit<CordisProfile, "releases" | "assetsLicense"> & { community: NonNullable<CordisProfile["community"]> },
  client: Omit<NonNullable<CordisRelease["communityClient"]>, "package" | "sha256">,
  pins: readonly (readonly [version: string, integrity: string, assetHash: string])[],
): CordisProfile {
  return {
    ...manifest, assetsLicense: "MIT",
    releases: pins.map(([version, integrity, sha256]) => ({
      version, schema: 1, cordis: CORDIS_VERSION, hostApi: CORDIS_HOST_API, bundle: "simple-insert",
      services: ["pioraStorage", "pioraPanel"],
      communityClient: { ...client, package: manifest.community.package, sha256 },
      packages: [
        { name: manifest.community.package, version, license: "MIT", source: { kind: "npm", integrity: "sha512-" + integrity } },
        { name: adapter, version, license: "MIT", entry: "index.cjs", inject: ["pioraStorage", "pioraPanel"],
          config: { version }, source: { kind: "bundled", files: [
            { source: "community/provider.cjs", path: "index.cjs", sha256: "84462e66f3f65deb5faf0e84a3d1daa6437a02fbb8db4609dbf8634a9bbeca7a" },
          ] } },
      ],
      health: { package: adapter, method: "community.health" },
    })),
  };
}

const conversation = "@deepseek-ai/dsh-client-ui-conversation";
const locale = "@deepseek-ai/dsh-client-locale";
export const communityCordisCatalog: readonly CordisProfile[] = [
  profile({
    id: "dsh-niuma-timer", name: "牛马计时器 · Niuma Timer",
    source: "https://github.com/yzzshanyin-rgb/dsh-niuma-timer",
    description: { en: "Track work time and earnings based on your salary and schedule.", zh: "按月薪和上下班时间计算今天、本周和本月的收入。" },
    community: { package: "dsh-niuma-timer", note: { en: "Runs in its own window.", zh: "在独立窗口运行。" } },
  }, { asset: "client.js", slots: ["conversation.composer.dock"], inject: [conversation] }, [
    ["1.3.0", "OOheDXZaXWhop320w9BSAaLunXsXs1K1ka/vFx5gmD7O/N7hYhGYXPMZhZSIFOdYIqNMk1bvcyIS23H4DtLOrQ==", "9b10e546b563947e9dc1715aecfce1a5bd82a7131c4977740ec1e0656b7aa0da"],
    ["1.2.1", "Vu30qjjm1I5p0Vx20NiVIT68f4n8NvQLjb7ghBV2wxVpXPQEX9mmu3qzz6Gea+KD2h071rmo2Ohx/hHi/GoU+w==", "cbe03d663094b285e64003e9e788f64dc201b11db71e358d5339400fc9cc58ee"],
  ]),
  profile({
    id: "dsh-pomodoro-box", name: "番茄盲盒 · Pomodoro Box",
    source: "https://github.com/WU55UY/dsh-pomodoro-box",
    description: { en: "Set focus and break timers and collect rewards for completed sessions.", zh: "设定专注和休息时长，完成番茄钟领取收藏奖励。" },
    community: { package: "dsh-pomodoro-box", note: { en: "Runs in its own window.", zh: "在独立窗口运行。" } },
  }, { asset: "client.js", slots: ["conversation.composer.dock", "shell.overlay"], inject: [locale, conversation] }, [
    ["1.2.4", "1BW0ZmORNJyU9aGYWowUWYhUMJjI12R4r/d2y8N0AEYZmK+Uph8omUSNnuQpzpcPWFnmlwlvH7dJJhxYfGMATA==", "f1b82988d9557b66e97732e7c9120486e0ce908f136391fe9cbbf35035a33194"],
    ["1.2.3", "vghnXb264utvsdQ1EaLq/Cn0E4fZgUTY56jqaYnnK2OpYZYVfPjDrMkWoX11ZFMB5oooX62IscZHURRNgUVSOQ==", "f1b82988d9557b66e97732e7c9120486e0ce908f136391fe9cbbf35035a33194"],
  ]),
  profile({
    id: "dsh-panda-calendar", name: "熊猫日历 · Panda Calendar",
    source: "https://github.com/runcat-tommy/dsh-panda-calendar",
    description: { en: "Browse the solar and lunar calendar, festivals, and solar terms.", zh: "查看公历、农历、节日和节气，支持时间戳换算。" },
    community: { package: "dsh-panda-calendar", note: {
      en: "Offline window. Live weather, location, online holiday data, and sending to chat are unavailable.",
      zh: "在独立窗口离线运行。天气、定位、联网节假日和发送到对话暂不可用。",
    } },
  }, { asset: "lib/client.js", slots: ["conversation.view"],
    inject: ["@deepseek-ai/dsh-client-runtime", locale, "@deepseek-ai/dsh-client-ui-slots", conversation] }, [
    ["1.2.5", "954RG4dqLga+J/L8vuaeiRs0Lcy2miHGr1RSkUajy+dnucbf51zkV0JQWsonQNGftK03KNIUNp6ApiCNPb0veg==", "f3b826c1ae293073c0f99d4abb8e27dca97d33e9777f5b92160e154bffce6c5c"],
    ["1.2.4", "z4nH9P6SEnw2aOHAznRjsDBqzmDzRkRnNKZ8B/7SOolZRrjeB/SZbvDBGawh7OIuu+NChUrbyniBrFLuwRXVxQ==", "f3b826c1ae293073c0f99d4abb8e27dca97d33e9777f5b92160e154bffce6c5c"],
  ]),
];
