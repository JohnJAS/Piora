import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep webpack/nft tracing inside the repository on Windows. Without an
  // explicit root, monorepo/workspace detection can broaden the standalone
  // trace and make the packaged output less deterministic.
  outputFileTracingRoot: __dirname,
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "playwright-core",
  ],
  webpack(config, { isServer }) {
    // The instrumentation entry is compiled through a separate webpack path
    // that does not apply serverExternalPackages consistently. Keep undici as
    // a Node runtime dependency there as well; bundling it pulls in node:console
    // from its mock tooling and breaks the dev compiler.
    if (isServer && Array.isArray(config.externals)) {
      config.externals.push("undici");
    }
    return config;
  },
  // Dev-only: allow remote testing via localtunnel/Cloudflare-style public
  // hosts without a hard-coded tunnel name. `*.loca.lt` is the localtunnel
  // public suffix; LAN IPs keep on-network testing working. Never affects
  // production (dev servers only).
  allowedDevOrigins: ['192.168.*.*', '*.loca.lt'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
