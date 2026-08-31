export interface DesktopDevelopmentRuntime {
  token: string;
  url: URL;
}

export function resolveDesktopDevelopmentRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): DesktopDevelopmentRuntime | null {
  const rawUrl = environment.PI_DESKTOP_DEV_SERVER_URL?.trim();
  if (!rawUrl) return null;

  const token = environment.PI_DESKTOP_TOKEN?.trim();
  if (!token || token.length < 32) {
    throw new Error("PI_DESKTOP_TOKEN must contain at least 32 characters in desktop development mode");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("PI_DESKTOP_DEV_SERVER_URL must be a valid URL");
  }
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("PI_DESKTOP_DEV_SERVER_URL must be an authenticated http://127.0.0.1:<port>/ origin");
  }
  return { token, url };
}

export function isDesktopApplicationTransportUrl(rawUrl: string, applicationUrl: URL): boolean {
  try {
    const candidate = new URL(rawUrl);
    if (candidate.hostname !== applicationUrl.hostname || candidate.port !== applicationUrl.port) return false;
    if (candidate.protocol === applicationUrl.protocol) return true;
    return applicationUrl.protocol === "http:" && candidate.protocol === "ws:"
      || applicationUrl.protocol === "https:" && candidate.protocol === "wss:";
  } catch {
    return false;
  }
}
