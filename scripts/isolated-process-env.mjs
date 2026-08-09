import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ALLOWED_HOST_ENVIRONMENT_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATH",
  "PATHEXT",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
]);

function readEnvironmentKey(environment, requestedKey) {
  const actualKey = Object.keys(environment).find(
    (key) => key.toLowerCase() === requestedKey.toLowerCase(),
  );
  return actualKey ? environment[actualKey] : undefined;
}

export function getIsolatedEnvironmentPaths(root) {
  const isolatedRoot = resolve(root);
  return Object.freeze({
    root: isolatedRoot,
    home: join(isolatedRoot, "home"),
    appData: join(isolatedRoot, "appdata"),
    localAppData: join(isolatedRoot, "localappdata"),
    temp: join(isolatedRoot, "temp"),
    xdgConfig: join(isolatedRoot, "xdg-config"),
    xdgCache: join(isolatedRoot, "xdg-cache"),
    xdgData: join(isolatedRoot, "xdg-data"),
    npmCache: join(isolatedRoot, "npm-cache"),
    npmUserConfig: join(isolatedRoot, "isolated.npmrc"),
    userData: join(isolatedRoot, "electron-user-data"),
  });
}

export async function prepareIsolatedEnvironment(root) {
  const paths = getIsolatedEnvironmentPaths(root);
  await Promise.all([
    paths.home,
    paths.appData,
    paths.localAppData,
    paths.temp,
    paths.xdgConfig,
    paths.xdgCache,
    paths.xdgData,
    paths.npmCache,
    paths.userData,
  ].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(paths.npmUserConfig, "# intentionally empty for isolated verification\n", {
    encoding: "utf8",
    flag: "w",
  });
  return paths;
}

/**
 * Build a deliberately small environment for release verification children.
 * In particular, credentials, proxy settings, CODEX_HOME, NODE_OPTIONS and
 * host npm configuration are never copied from the caller.
 */
export function createIsolatedProcessEnvironment(
  root,
  additions = {},
  hostEnvironment = process.env,
) {
  const paths = getIsolatedEnvironmentPaths(root);
  const environment = {};

  for (const key of ALLOWED_HOST_ENVIRONMENT_KEYS) {
    const value = readEnvironmentKey(hostEnvironment, key);
    if (typeof value === "string" && value) environment[key] = value;
  }

  Object.assign(environment, {
    HOME: paths.home,
    USERPROFILE: paths.home,
    PIORA_HOME: paths.home,
    APPDATA: paths.appData,
    LOCALAPPDATA: paths.localAppData,
    TEMP: paths.temp,
    TMP: paths.temp,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_CACHE_HOME: paths.xdgCache,
    XDG_DATA_HOME: paths.xdgData,
    NPM_CONFIG_CACHE: paths.npmCache,
    NPM_CONFIG_USERCONFIG: paths.npmUserConfig,
  });

  for (const [key, value] of Object.entries(additions)) {
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}
