import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();
    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }


    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const directories = await listDirectories(resolved);
    const parentPath = getParentDirectory(resolved);
    let browseEntries = directories;
    // On Windows a drive root has no parent, so surface sibling drives as
    // pickable entries to let the user switch between disks.
    if (process.platform === "win32" && parentPath === null) {
      const drives = await listWindowsDrives();
      const currentRoot = resolved.replace(/[\\/]+$/, "").toLowerCase();
      browseEntries = [
        ...drives.filter(
          (drive) => drive.path.replace(/[\\/]+$/, "").toLowerCase() !== currentRoot,
        ),
        ...directories,
      ];
    }

    return NextResponse.json({
      path: resolved,
      parentPath,
      directories: browseEntries,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
