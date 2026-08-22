import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ExtensionStatusBar,
  formatExtensionStatusLine,
  sanitizeExtensionStatusText,
} = await jiti.import("./ExtensionStatusBar.tsx");

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("sanitizes status text for a single-line display", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second third",
  );
});

test("renders a single status line without identifier keys", () => {
  const html = renderToStaticMarkup(
    React.createElement(ExtensionStatusBar, {
      statuses: [
        { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
        { key: "05-ponytail", text: "ponytail" },
      ],
    }),
  );

  assert.match(html, /aria-label="ponytail memory"/);
  assert.match(html, /role="tooltip"/);
  assert.match(html, /工具状态/);
  assert.match(html, /<svg/);
  assert.match(html, />ponytail <\/span>/);
  assert.match(html, />memory</);
  assert.doesNotMatch(html, /05-ponytail|20-memory/);
});

test("keeps extension status inside the composer instead of rendering a footer bar", async () => {
  const [chatInput, chatWindow, styles] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/globals.css", import.meta.url), "utf8")),
  ]);
  assert.match(chatInput, /<ExtensionStatusBar statuses=\{extensionStatuses\}/);
  assert.doesNotMatch(chatWindow, /<ExtensionStatusBar statuses=/);
  const statusStyles = styles.slice(styles.indexOf(".extension-status-control"), styles.indexOf(".extension-status-control") + 2600);
  assert.match(statusStyles, /width:\s*28px/);
  assert.doesNotMatch(statusStyles, /border-top/);
});
