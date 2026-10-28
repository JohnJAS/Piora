import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const expectedJobs = ["ubuntu-latest", "windows-latest"].flatMap(os =>
  [1, 2, 3, 4, 5, 6].map(shard => `tests / Tests (${os}, shard ${shard}/6)`));

export function selectMainPushRun(runs, sha) {
  return runs.find(run => run.head_sha === sha && run.head_branch === "main"
    && run.event === "push" && run.path === ".github/workflows/ci.yml") ?? null;
}

export function inspectTestJobs(run, jobs) {
  const selected = expectedJobs.map(name => jobs.filter(job => job.name === name));
  if (selected.some(matches => matches.length > 1)) return "fallback";
  if (selected.some(matches => matches[0]?.status === "completed" && matches[0].conclusion !== "success")) return "fallback";
  if (selected.every(matches => matches.length === 1 && matches[0].status === "completed" && matches[0].conclusion === "success")) return "reuse";
  return run.status === "completed" ? "fallback" : "wait";
}

export async function findReusableTests({ sha, getRuns, getJobs, now = Date.now,
  delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms)),
  maxWaitMs = 25 * 60_000, missingRunWaitMs = 60_000, pollMs = 20_000 }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return "fallback";
  const started = now();
  while (now() - started < maxWaitMs) {
    try {
      const run = selectMainPushRun(await getRuns(), sha);
      if (run) {
        const result = inspectTestJobs(run, await getJobs(run.id));
        if (result !== "wait") return result;
      } else if (now() - started >= missingRunWaitMs) return "fallback";
    } catch (error) {
      console.warn(`Unable to inspect main CI; running the full fallback suite: ${error.message}`);
      return "fallback";
    }
    await delay(pollMs);
  }
  return "fallback";
}

async function main() {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_TOKEN: token, GITHUB_OUTPUT: output } = process.env;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "") || !token || !output) throw new Error("Missing GitHub CI lookup context");
  const api = async path => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    return response.json();
  };
  const result = await findReusableTests({ sha,
    getRuns: async () => (await api(`actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`)).workflow_runs,
    getJobs: async id => (await api(`actions/runs/${id}/jobs?filter=latest&per_page=100`)).jobs,
  });
  await appendFile(output, `reuse=${result === "reuse"}\n`);
  console.log(result === "reuse" ? `Reusing all twelve successful main CI test shards for ${sha}.` : "No complete matching main CI result; run all test shards for the tag.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
