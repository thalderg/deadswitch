/* The reminder schedule, as pure functions (unit-tested in schedule.test.ts).
 *
 * Reminders are anchored to the deadline, so the last ones always arrive before it:
 *   more than 30 days left  -> once a month   (30, 60, 90… days before the deadline)
 *   30 to 7 days left       -> once a week    (28, 21, 14, 7 days before)
 *   7 to 2 days left        -> every 2 days   (6, 4 days before)
 *   last 2 days             -> once a day     (2, 1 days before)
 * Only times after the last check-in count (a check-in resets the schedule), and two
 * reminders are never less than a day apart. In demo mode, the given offsets are used
 * instead, and the one-a-day rule doesn't apply. */

export const DAY = 86_400_000;

const REAL_OFFSET_DAYS = [1, 2, 4, 6, 7, 14, 21, 28];

/** Every reminder time between the last check-in and the deadline, ascending (ms). */
export function reminderTimes(lastCheckinMs: number, deadlineMs: number, demoOffsetsSec: number[] = []): number[] {
  if (demoOffsetsSec.length) {
    return [...new Set(demoOffsetsSec)]
      .map((s) => deadlineMs - s * 1000)
      .filter((t) => t > lastCheckinMs && t < deadlineMs)
      .sort((a, b) => a - b);
  }
  const span = deadlineMs - lastCheckinMs;
  const offsets = [...REAL_OFFSET_DAYS.map((d) => d * DAY)];
  for (let k = 30 * DAY; k < span; k += 30 * DAY) offsets.push(k);
  const candidates = [...new Set(offsets)].map((o) => deadlineMs - o).filter((t) => t > lastCheckinMs).sort((a, b) => b - a);
  /* Walk back from the deadline, keeping times at least a day apart. */
  const kept: number[] = [];
  for (const t of candidates) if (!kept.length || kept[kept.length - 1] - t >= DAY) kept.push(t);
  return kept.reverse();
}

/**
 * The reminder to send now, or null. `lastScheduled` is the schedule time of the last
 * reminder sent since the last check-in, and `lastSentAt` when it actually went out.
 * If several were missed (e.g. the service was down), only the most recent one is sent.
 */
export function dueReminder(times: number[], nowMs: number, lastScheduled: number | null, lastSentAt: number | null, demo = false): number | null {
  if (!demo && lastSentAt !== null && nowMs - lastSentAt < DAY) return null;
  let due: number | null = null;
  for (const t of times) if (t <= nowMs && (lastScheduled === null || t > lastScheduled)) due = t;
  return due;
}

/** The reminder after `t`, if any: the moment the current check-in link stops working. */
export function nextReminderAfter(times: number[], t: number): number | null {
  return times.find((x) => x > t) ?? null;
}
