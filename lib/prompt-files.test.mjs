import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { savePromptFiles } = await jiti.import("./prompt-files.ts");
const { buildLocalFilePrompt } = await jiti.import("./file-attachments.ts");
const { getCloneableBody } = createRequire(import.meta.url)("next/dist/server/body-streams.js");

test("binary attachments keep exact bytes and extensions, and only paths enter the model prompt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-file-attachments-"));
  try {
    const bytes = new Uint8Array([0x50, 0x4b, 0, 255, 128, 10, 13]);
    const files = await savePromptFiles([new File([bytes], "报告.xlsx"), new File([bytes], "../../CON.pdf"), new File(["中文原文"], "说明.txt")], root);
    for (const file of files) {
      assert.ok(path.resolve(file.path).startsWith(path.resolve(root) + path.sep));
      assert.equal(path.extname(file.path), path.extname(file.name));
      assert.equal(file.text, null);
    }
    assert.deepEqual(new Uint8Array(await readFile(files[0].path)), bytes);
    assert.deepEqual(new Uint8Array(await readFile(files[1].path)), bytes);
    assert.equal(await readFile(files[2].path, "utf8"), "中文原文");
    const prompt = buildLocalFilePrompt("请读取附件", files);
    for (const file of files) assert.ok(prompt.includes(JSON.stringify(file.path)));
    assert.ok(prompt.startsWith("请读取附件"));
    assert.ok(!prompt.includes("中文原文"));
    assert.match(buildLocalFilePrompt("", files), /local files/);
    assert.equal(buildLocalFilePrompt("ordinary message", []), "ordinary message");
    const interrupted = new File([bytes], "broken.pdf");
    interrupted.arrayBuffer = async () => { throw new Error("read failed"); };
    const before = await readdir(root);
    await assert.rejects(savePromptFiles([new File([bytes], "first.pdf"), interrupted], root), /read failed/);
    assert.deepEqual(await readdir(root), before, "failed batch leaves no partial stored files");
    await assert.rejects(savePromptFiles([], root), /between/);
    await assert.rejects(savePromptFiles(Array.from({ length: 9 }, () => new File([bytes], "file.pdf")), root), /between/);
  } finally {
    assert.ok(root.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

test("supported multipart attachments survive the actual Next proxy above its default 10 MiB limit", async () => {
  const config = await jiti.import("../next.config.ts", { default: true });
  const bytes = new Uint8Array(11 * 1024 * 1024).fill(128);
  const form = new FormData();
  form.append("files", new File([bytes], "larger-than-proxy-default.pdf"));
  const request = new Request("http://localhost/api/prompt-files", { method: "POST", body: form });
  const body = getCloneableBody(Readable.from([Buffer.from(await request.arrayBuffer())]), config.experimental.proxyClientMaxBodySize);
  const chunks = [];
  for await (const chunk of body.cloneBodyStream()) chunks.push(chunk);
  const restored = await new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) }).formData();
  assert.deepEqual(new Uint8Array(await restored.get("files").arrayBuffer()), bytes);
});
