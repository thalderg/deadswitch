import { describe, expect, it } from 'vitest';
import { ago, bpsToPct, countdown, formatAmount, humanDuration, leftLabel, passedPct, pctLabel, pctToBps, shareOf, utcDateTime } from './format';

describe('formatAmount', () => {
  it('formats wNEAR with 24 decimals', () => {
    expect(formatAmount('100000000000000000000000', 24)).toBe('0.1');
    expect(formatAmount('1500000000000000000000000', 24)).toBe('1.5');
    expect(formatAmount('0', 24)).toBe('0');
  });
  it('shows tiny amounts as < 0.0001', () => {
    expect(formatAmount('1', 24)).toBe('< 0.0001');
  });
  it('groups thousands', () => {
    expect(formatAmount('1234500000', 6)).toBe('1,234.5');
  });
});

describe('shares', () => {
  it('formats basis points', () => {
    expect(bpsToPct(7000)).toBe('70%');
    expect(bpsToPct(3333)).toBe('33.33%');
  });
  it('parses percent input', () => {
    expect(pctToBps('70')).toBe(7000);
    expect(pctToBps('33,33')).toBe(3333);
    expect(pctToBps('0')).toBeNull();
    expect(pctToBps('33.333')).toBeNull();
    expect(pctToBps('abc')).toBeNull();
  });
  it('splits like the contract', () => {
    expect(shareOf('1000', 7000)).toBe('700');
    expect(shareOf('100000000000000000000000', 3000)).toBe('30000000000000000000000');
  });
});

describe('time', () => {
  it('names durations', () => {
    expect(humanDuration(60_000)).toBe('1 minute');
    expect(humanDuration(86_400_000 * 3)).toBe('3 days');
    expect(humanDuration(86_400_000 * 180)).toBe('6 months');
  });
  it('counts down', () => {
    expect(countdown(86_400_000 * 2 + 3_600_000 * 5 + 60_000 * 7)).toBe('2 days 5 h 07 min');
    expect(countdown(185_000)).toBe('3 min 05 s');
  });
  it('says how long ago', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(90_000_000)).toBe('yesterday');
    expect(ago(86_400_000 * 21)).toBe('3 weeks ago');
  });
  it('formats UTC date and time', () => {
    expect(utcDateTime(Date.UTC(2027, 4, 12, 9, 14))).toBe('12 May 2027 at 09:14 UTC');
  });
  it('computes the passed share of the period', () => {
    expect(passedPct(0, 100, 25)).toBe(25);
    expect(passedPct(0, 100, 150)).toBe(100);
    expect(pctLabel(4.25)).toBe('4.3');
    expect(pctLabel(42.6)).toBe('43');
    expect(leftLabel(8.8)).toBe('91.2');
    expect(leftLabel(42.6)).toBe('57');
  });
});
