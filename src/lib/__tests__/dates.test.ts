import { addDays, dayKey, monthGrid, parseDayKey, startOfWeek, weekDays } from '../dates';

describe('day keys (local YYYY-MM-DD, PLAN §4)', () => {
  it('zero-pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('round-trips through parseDayKey', () => {
    expect(dayKey(parseDayKey('2026-08-05'))).toBe('2026-08-05');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('week helpers (Sunday start)', () => {
  it('startOfWeek returns the Sunday of the containing week', () => {
    // 2026-08-05 is a Wednesday; its week starts Sunday 2026-08-02.
    expect(startOfWeek('2026-08-05')).toBe('2026-08-02');
    expect(startOfWeek('2026-08-02')).toBe('2026-08-02');
  });

  it('weekDays lists the 7 consecutive days', () => {
    const days = weekDays('2026-08-02');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-02');
    expect(days[6]).toBe('2026-08-08');
  });
});

describe('monthGrid (calendar picker, PLAN Part 2.1)', () => {
  it('produces full 7-cell rows covering exactly the month, weekday-aligned', () => {
    const rows = monthGrid(2026, 8);
    for (const row of rows) expect(row).toHaveLength(7);
    const cells = rows.flat();
    const days = cells.filter((c): c is string => c !== null);
    expect(days[0]).toBe('2026-08-01');
    expect(days[days.length - 1]).toBe('2026-08-31');
    expect(days).toHaveLength(31);
    // Padding aligns day 1 with its weekday column (Aug 1 2026 is a Saturday).
    expect(cells.indexOf('2026-08-01')).toBe(new Date(2026, 7, 1).getDay());
  });
});
