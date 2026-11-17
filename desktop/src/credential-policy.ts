/** Protocol policy is shared by storage, capture and trusted fill execution. */
export function credentialHttpOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || url.hostname.includes("xn--")) throw new Error("Invalid HTTP credential origin");
  return url.origin;
}

/** Storage validation is independent of current grants so revoking a site never corrupts its records. */
export function storedCredentialUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hostname.includes("*") || url.hostname.includes("xn--")) throw new Error("Invalid credential URL");
  if (url.protocol === "https:" && (!url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname))) throw new Error("Invalid credential URL");
  return url.origin + url.pathname;
}

export function credentialUrl(value: string, httpOrigins: readonly string[] = []): string {
  const target = storedCredentialUrl(value);
  const url = new URL(target);
  if (url.protocol === "http:" && !httpOrigins.includes(url.origin)) throw new Error("HTTP credential origin is not allowed");
  return target;
}
