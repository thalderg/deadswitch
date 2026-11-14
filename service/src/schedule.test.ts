import { describe, expect, it } from 'vitest';
import { DAY, dueReminder, nextReminderAfter, reminderTimes } from './schedule';

const T0 = Date.UTC(2026, 0, 1);
const daysBefore = (deadline: number, times: number[]) => times.map((t) => (deadline - t) / DAY);

describe('reminderTimes', () => {
  it('follows the bands for a 12-month timer', () => {
    const deadline = T0 + 365 * DAY;
    const times = reminderTimes(T0, deadline);
    const before = daysBefore(deadline, times);
    // monthly beyond 30 days, weekly 30-7, every 2 days 7-2, daily in the last 2
    expect(before.slice(-8)).toEqual([28, 21, 14, 7, 6, 4, 2, 1]);
    expect(before).toContain(30);
    expect(before).toContain(60);
    expect(before).toContain(360);
    expect(before.every((d) => d < 365)).toBe(true);
  });

  it('keeps reminders at least a day apart and ascending', () => {
    const deadline = T0 + 200 * DAY;
    const times = reminderTimes(T0, deadline);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(DAY);
  });

  it('only counts times after the last check-in', () => {
    const deadline = T0 + 10 * DAY;
    expect(daysBefore(deadline, reminderTimes(T0, deadline))).toEqual([7, 6, 4, 2, 1]);
    const last = deadline - 5 * DAY;   // checked in 5 days before the deadline
    expect(daysBefore(deadline, reminderTimes(last, deadline))).toEqual([4, 2, 1]);
  });

  it('sends nothing for a 1-day timer (no reminder time after the check-in)', () => {
    expect(reminderTimes(T0, T0 + DAY)).toEqual([]);
  });

  it('uses the demo offsets exactly, once each', () => {
    const deadline = T0 + 600_000;
    expect(reminderTimes(T0, deadline, [300, 120, 300])).toEqual([deadline - 300_000, deadline - 120_000]);
    // offsets before the last check-in are skipped
    expect(reminderTimes(deadline - 200_000, deadline, [300, 120])).toEqual([deadline - 120_000]);
  });
});

describe('dueReminder', () => {
  const deadline = T0 + 10 * DAY;
  const times = reminderTimes(T0, deadline);   // 7, 6, 4, 2, 1 days before

  it('is null before the first reminder time', () => {
    expect(dueReminder(times, deadline - 8 * DAY, null, null)).toBeNull();
  });
  it('returns the reminder once its time has come', () => {
    expect(dueReminder(times, deadline - 7 * DAY + 1000, null, null)).toBe(deadline - 7 * DAY);
  });
  it('never sends twice for the same time', () => {
    expect(dueReminder(times, deadline - 7 * DAY + 5000, deadline - 7 * DAY, null)).toBeNull();
  });
  it('never sends two reminders within a day', () => {
    // the 7-day reminder went out late (6.5 days before); the 6-day one is only 12 h later
    expect(dueReminder(times, deadline - 6 * DAY + 1000, deadline - 7 * DAY, deadline - 6.5 * DAY)).toBeNull();
    expect(dueReminder(times, deadline - 5.4 * DAY, deadline - 7 * DAY, deadline - 6.5 * DAY)).toBe(deadline - 6 * DAY);
  });
  it('sends only the latest one after missed reminders', () => {
    expect(dueReminder(times, deadline - 1.5 * DAY, null, null)).toBe(deadline - 2 * DAY);
  });
  it('ignores the one-a-day rule in demo mode', () => {
    const d = T0 + 600_000;
    const demo = reminderTimes(T0, d, [300, 120]);
    expect(dueReminder(demo, d - 119_000, d - 300_000, d - 299_000, true)).toBe(d - 120_000);
  });
});

describe('nextReminderAfter', () => {
  it('finds the next time, or null for the last reminder', () => {
    const deadline = T0 + 10 * DAY;
    const times = reminderTimes(T0, deadline);
    expect(nextReminderAfter(times, deadline - 7 * DAY)).toBe(deadline - 6 * DAY);
    expect(nextReminderAfter(times, deadline - DAY)).toBeNull();
  });
});
