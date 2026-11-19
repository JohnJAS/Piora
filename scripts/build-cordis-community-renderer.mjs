export async function buildCordisCommunityRenderer(root) {
  const { build } = await import("esbuild");
  await build({
    entryPoints: ["desktop/renderer/cordis-community.jsx", "desktop/renderer/cordis-community.css"],
    absWorkingDir: root, outdir: "desktop/dist", platform: "browser", bundle: true, format: "iife",
    minify: true, legalComments: "eof", define: { "process.env.NODE_ENV": '"production"' },
  });
}
