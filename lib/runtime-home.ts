import path from "node:path";

export interface RuntimeHomeEnvironment {
  readonly [key: string]: string | undefined;
  PI_GUI_HOME?: string;
  USERPROFILE?: string;
  HOME?: string;
}

/**
 * Resolve the home directory at request/runtime instead of through os.homedir().
 * Next's output-file tracer statically evaluates os.homedir() and can turn a
 * later dynamic filesystem call into a recursive glob over the entire user
 * profile. Windows compatibility junctions then fail that build with EPERM.
 */
export function getRuntimeHomeDirectory(
  environment: RuntimeHomeEnvironment = process.env,
): string {
  const configuredHome = environment.PI_GUI_HOME?.trim();
  const platformHome = (process.platform === "win32"
    ? environment.USERPROFILE
    : environment.HOME)?.trim();
  const fallbackHome = (environment.HOME || environment.USERPROFILE)?.trim();
  const homeDirectory = configuredHome || platformHome || fallbackHome;

  if (!homeDirectory) {
    throw new Error(
      "Unable to resolve the home directory. Set PI_GUI_HOME, USERPROFILE, or HOME.",
    );
  }

  return path.resolve(homeDirectory);
}
