import { execFile } from "node:child_process";
import { join } from "node:path";

/** Matches the backend WindowsIdentity schema. Never proof of authentication. */
export interface WindowsIdentity {
  account_type: "domain" | "local" | "unknown";
  domain: string | null;
  account_name: string | null;
  source: "windows_logon" | "unavailable";
}

export interface IdentityObservation extends WindowsIdentity {
  status: "available" | "unsupported" | "read_failed" | "unconfirmed";
}

export function unknownIdentity(
  status: IdentityObservation["status"],
): IdentityObservation {
  return {
    account_type: "unknown",
    domain: null,
    account_name: null,
    source: "unavailable",
    status,
  };
}

// Use the current process token's SID, not the interactive desktop user or a
// guessed profile directory. CIM must positively identify that exact account.
const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
if ($sid -notmatch '^S-1-5-21-(\d+-){3}\d+$') { throw 'Unsupported account SID' }
$account = @(Get-CimInstance -ClassName Win32_UserAccount -Filter "SID='$sid'")
if ($account.Count -ne 1) { throw 'Account not resolved' }
[ordered]@{ name=$identity.Name; sid=$sid; account_sid=$account[0].SID; domain=$account[0].Domain; login=$account[0].Name; local=$account[0].LocalAccount } | ConvertTo-Json -Compress
`;

export function parseWindowsIdentity(text: string): IdentityObservation {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, "").trim());
    const valid = (v: unknown): v is string =>
      typeof v === "string" &&
      v.length > 0 &&
      v.length <= 128 &&
      !/[\\/\x00-\x1f\x7f]/.test(v);
    if (
      !valid(value.domain) ||
      !valid(value.login) ||
      typeof value.local !== "boolean" ||
      typeof value.sid !== "string" ||
      !/^S-1-5-21-(\d+-){3}\d+$/.test(value.sid) ||
      value.sid !== value.account_sid ||
      typeof value.name !== "string" ||
      value.name.toUpperCase() !==
        `${value.domain}\\${value.login}`.toUpperCase()
    )
      return unknownIdentity("unconfirmed");
    return {
      account_type: value.local ? "local" : "domain",
      domain: value.local ? null : value.domain,
      account_name: value.local ? null : value.login,
      source: "windows_logon",
      status: "available",
    };
  } catch {
    return unknownIdentity("read_failed");
  }
}

export async function collectWindowsIdentity(
  enabled: boolean,
  platform: string = process.platform,
  run: () => Promise<string> = runProbe,
): Promise<IdentityObservation> {
  if (!enabled || platform !== "win32") return unknownIdentity("unsupported");
  try {
    return parseWindowsIdentity(await run());
  } catch {
    return unknownIdentity("read_failed");
  }
}

function runProbe(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: "utf8" },
      (error, stdout) =>
        error ? reject(new Error("IDENTITY_READ_FAILED")) : resolve(stdout),
    );
  });
}
