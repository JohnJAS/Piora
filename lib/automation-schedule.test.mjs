import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { nextAutomationOccurrence, normalizeRRule, validateTimezone } = await jiti.import("./automation-schedule.ts");

test("normalizes and advances recurring minute schedules", () => {
  const anchor = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(normalizeRRule("freq=minutely;interval=5"), "RRULE:FREQ=MINUTELY;INTERVAL=5");
  assert.equal(nextAutomationOccurrence("RRULE:FREQ=MINUTELY;INTERVAL=5", anchor, anchor, "UTC"), anchor + 5 * 60_000);
});

test("validates IANA timezones and rejects malformed recurrence input", () => {
  assert.equal(validateTimezone("Asia/Shanghai"), "Asia/Shanghai");
  assert.throws(() => validateTimezone("Mars/Olympus"), /Unknown timezone/);
  assert.throws(() => normalizeRRule("every five minutes"), /RRULE/);
});

test("preserves timezone-aware daily schedules", () => {
  const anchor = Date.parse("2026-01-01T00:00:00.000Z");
  const next = nextAutomationOccurrence("RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0", anchor, anchor, "Asia/Shanghai");
  assert.ok(Number.isFinite(next));
  const localHour = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23" }).format(new Date(next));
  assert.equal(localHour, "09");
});
