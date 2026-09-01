import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  preparePreviewUpdateFeed,
  releaseTagsFromAtom,
  selectDesktopReleaseCandidate,
} = await jiti.import("../desktop/src/update-release-selector.ts");

const feed = (tags) => tags.map((tag) => (
  `<entry><link href="https://github.com/kexijiang/Piora/releases/tag/${tag}" /></entry>`
)).join("\n");

test("release tags are de-duplicated from the GitHub Atom feed", () => {
  assert.deepEqual(releaseTagsFromAtom(feed(["v0.4.40", "v0.4.40-beta.2", "v0.4.40"])), [
    "v0.4.40",
    "v0.4.40-beta.2",
  ]);
});

test("preview users receive the highest semantic version across stable and beta releases", () => {
  const unordered = ["harmony-v0.4.39", "v0.4.40-beta.4", "v0.4.40", "v0.4.41-beta.2", "v0.4.41-beta.1"];
  assert.deepEqual(selectDesktopReleaseCandidate(unordered, "0.4.39", "preview"), {
    tag: "v0.4.41-beta.2",
    version: "0.4.41-beta.2",
    channel: "beta",
  });
  assert.deepEqual(selectDesktopReleaseCandidate(unordered, "0.4.41-beta.2", "preview"), null);
  assert.deepEqual(selectDesktopReleaseCandidate(["v0.4.41-beta.2", "v0.4.41"], "0.4.41-beta.2", "preview"), {
    tag: "v0.4.41",
    version: "0.4.41",
    channel: "latest",
  });
});

test("stable users ignore beta releases", () => {
  assert.deepEqual(selectDesktopReleaseCandidate(["v0.4.41-beta.9", "v0.4.40"], "0.4.39", "stable"), {
    tag: "v0.4.40",
    version: "0.4.40",
    channel: "latest",
  });
});

test("preview feed preparation pins the selected GitHub release and disables downgrade", async () => {
  const updater = {
    allowPrerelease: false,
    allowDowngrade: true,
    channel: null,
    feed: null,
    setFeedURL(value) { this.feed = value; },
  };
  const logger = { info() {}, warn() {}, error() {} };
  const prepared = await preparePreviewUpdateFeed(
    updater,
    "0.4.39",
    async () => ({ ok: true, status: 200, text: async () => feed(["v0.4.40", "v0.4.41-beta.2"]) }),
    logger,
  );

  assert.equal(prepared, true);
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.channel, "beta");
  assert.deepEqual(updater.feed, {
    provider: "generic",
    url: "https://github.com/kexijiang/Piora/releases/download/v0.4.41-beta.2",
    channel: "beta",
  });
});
