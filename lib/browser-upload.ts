import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { FileChooser, Frame, Locator, Page } from "playwright-core";
import { captureFileChooser, FILE_CHOOSER_TIMEOUT_MS, UPLOAD_PAGE_CHANGED_ERROR } from "../desktop/src/browser-agent-logic.ts";

export async function resolveUploadFiles(files: string[] | undefined, cwd: string): Promise<string[]> {
  if (!Array.isArray(files) || files.length === 0 || files.some(file => typeof file !== "string" || !file.trim() || file.includes("\0"))) {
    throw new Error("upload requires at least one local file path.");
  }
  return Promise.all(files.map(async file => {
    const path = resolve(cwd, file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`Upload path is not an accessible file: ${file}`);
    return path;
  }));
}

export async function uploadPlaywrightFiles(page: Page, locator: Locator, url: string, files: string[], signal?: AbortSignal): Promise<void> {
  let navigated = false;
  const onNavigate = (frame: Frame) => {
    if (frame === page.mainFrame()) navigated = true;
  };
  const assertCurrent = () => {
    if (signal?.aborted) throw new Error("Browser action aborted");
    if (navigated || page.url() !== url) throw new Error(UPLOAD_PAGE_CHANGED_ERROR);
  };
  page.on("framenavigated", onNavigate);
  try {
    assertCurrent();
    const options = { timeout: FILE_CHOOSER_TIMEOUT_MS };
    const target = await locator.elementHandle(options);
    try {
      const kind = await target.evaluate(element => ({
        fileInput: element instanceof HTMLInputElement && element.type === "file",
        disabled: element.matches(":disabled"),
      }));
      assertCurrent();
      if (kind.disabled) throw new Error("Upload control is disabled.");
      if (kind.fileInput) {
        await target.setInputFiles(files, options);
        return;
      }
      const chooser = await captureFileChooser<FileChooser>(
        accept => {
          page.on("filechooser", accept);
          return () => { page.off("filechooser", accept); };
        },
        () => {
          assertCurrent();
          return target.click(options);
        },
        signal,
      );
      try {
        assertCurrent();
        await chooser.setFiles(files, options);
      } finally {
        await chooser.element().dispose().catch(() => undefined);
      }
    } finally {
      await target.dispose().catch(() => undefined);
    }
  } finally {
    page.off("framenavigated", onNavigate);
  }
}
