import { writeFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";

export default function packagedExtensionVerificationFixture(pi) {
  const markerPath = process.env.PI_PACKAGE_VERIFY_MARKER;
  if (markerPath) {
    writeFileSync(markerPath, "packaged Pi extension loaded\n", "utf8");
  }

  pi.registerCommand("packaged-extension-probe", {
    description: "Verifies that an external Pi package command loads in the packaged app",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Packaged Pi extension command is available", "info");
    },
  });

  pi.registerTool({
    name: "packaged_extension_probe",
    label: "Packaged extension probe",
    description: "Verifies that an external Pi package tool loads in the packaged app",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "Packaged Pi extension tool is available" }],
        details: {},
      };
    },
  });
}
