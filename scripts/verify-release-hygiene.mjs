#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;

export const SECRET_RULES = Object.freeze([
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { id: "openai-api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { id: "slack-token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g },
  { id: "private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
]);

export const PORTABILITY_RULES = Object.freeze([
  {
    id: "repository-specific-absolute-path",
    pattern: /\b[A-Z]:[\\/](?:[^\\/\r\n]+[\\/])*(?:piGUI|Piora)(?:[\\/]|$)/gi,
  },
]);

const TEXT_EXTENSIONS = new Set([
  ".bat", ".cjs", ".cmd", ".css", ".csv", ".html", ".ini", ".js",
  ".json", ".jsx", ".md", ".mjs", ".ps1", ".scss", ".sh", ".svg",
  ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);

const TEXT_FILENAMES = new Set([
  ".gitignore", ".nvmrc", "codeowners", "license", "notice",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPrivatePathRules({ cwd = process.cwd(), home = homedir() } = {}) {
  const values = new Set();
  for (const candidate of [cwd, home, process.env.USERPROFILE]) {
    if (typeof candidate !== "string" || candidate.trim().length < 4) continue;
    values.add(candidate.trim());
    values.add(candidate.trim().replaceAll("\\", "/"));
  }
  return [...values].map((value, index) => ({
    id: `private-absolute-path-${index + 1}`,
    pattern: new RegExp(escapeRegExp(value), "gi"),
  }));
}

export function scanText(text, rules) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(lines[lineIndex])) {
        findings.push({ rule: rule.id, line: lineIndex + 1 });
      }
    }
  }
  return findings;
}

export function getSensitivePathReason(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const name = basename(lower);

  if (/^(?:\.env)(?:\.|$)/.test(name) && name !== ".env.example") {
    return "environment-file";
  }
  if (/\.(?:jsonl|pem|key|p12|pfx)$/.test(name)) {
    return "credential-or-session-file";
  }
  if (/^(?:auth|credentials|secrets)\.json$/.test(name)) {
    return "credential-file";
  }
  if (/(^|\/)(?:\.pi|\.codex|\.piora-data|local-pets)(?:\/|$)/.test(lower)) {
    return "runtime-user-data";
  }
  if (/^(?:\.next|desktop\/release|\.verification|verification-output)(?:\/|$)/.test(lower)) {
    return "generated-release-data";
  }
  return null;
}

function isTextFile(filePath) {
  const lowerName = basename(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extname(lowerName)) || TEXT_FILENAMES.has(lowerName);
}

function listReleaseTreeFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  );
  return [...new Set(output.toString("utf8").split("\0").filter(Boolean))].sort();
}

function inspectReleaseTree(files) {
  const findings = [];
  const contentRules = [
    ...SECRET_RULES,
    ...PORTABILITY_RULES,
    ...buildPrivatePathRules(),
  ];

  for (const filePath of files) {
    const pathReason = getSensitivePathReason(filePath);
    if (pathReason) {
      findings.push({ location: filePath, rule: pathReason });
      continue;
    }
    if (!isTextFile(filePath)) continue;

    const absolutePath = resolve(filePath);
    // `git ls-files --cached` also reports paths staged for deletion. They are
    // not part of the publishable tree and should not be treated as unreadable.
    if (!existsSync(absolutePath)) continue;
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      findings.push({ location: filePath, rule: "unreadable-file" });
      continue;
    }
    if (!stats.isFile()) {
      findings.push({ location: filePath, rule: "non-regular-file" });
      continue;
    }
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      findings.push({ location: filePath, rule: "oversized-text-file" });
      continue;
    }

    const bytes = readFileSync(absolutePath);
    if (bytes.includes(0)) {
      findings.push({ location: filePath, rule: "binary-content-in-text-file" });
      continue;
    }
    for (const finding of scanText(bytes.toString("utf8"), contentRules)) {
      findings.push({
        location: `${filePath}:${finding.line}`,
        rule: finding.rule,
      });
    }
  }
  return findings;
}

function inspectReachableHistory() {
  const history = execFileSync(
    "git",
    [
      "log", "--format=", "--no-color", "--no-ext-diff", "--no-textconv",
      "--patch", "HEAD",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  return scanText(history, SECRET_RULES).map((finding) => ({
    location: `reachable-history:${finding.line}`,
    rule: finding.rule,
  }));
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
}

function main() {
  const treeOnly = process.argv.includes("--tree-only");
  const files = listReleaseTreeFiles();
  const findings = inspectReleaseTree(files);
  if (!treeOnly) findings.push(...inspectReachableHistory());

  const uniqueFindings = [...new Map(
    findings.map((finding) => [`${finding.location}\0${finding.rule}`, finding]),
  ).values()];
  if (uniqueFindings.length > 0) {
    console.error("Release hygiene verification failed. Matches are redacted:");
    for (const finding of uniqueFindings) {
      console.error(`- ${finding.location} [${finding.rule}]`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Verified release hygiene for ${files.length} tracked/untracked files`
      + (treeOnly ? "." : " and reachable Git text history."),
  );
}

if (isMainModule()) main();
