import { spawnSync } from "node:child_process";

const rounds = Math.max(1, Math.min(100, Number(process.env.PIORA_TEAM_ACCEPTANCE_ROUNDS ?? 20) || 20));
for (let index = 0; index < rounds; index += 1) {
  const seed = `team-acceptance-${index + 1}`;
  const result = spawnSync(process.execPath, ["--test", "lib/team-coordinator-service.test.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PIORA_TEAM_TEST_SEED: seed },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.stderr.write(`Team acceptance failed at round ${index + 1}/${rounds}, seed=${seed}\n${result.stdout}${result.stderr}`);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`Team acceptance ${index + 1}/${rounds} passed (seed=${seed}).\n`);
}
