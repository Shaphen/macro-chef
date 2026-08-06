/** Day bucketing uses LOCAL 'YYYY-MM-DD' keys; the day boundary is local midnight. */

export function dayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return dayKey(new Date());
}

export function parseDayKey(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, delta: number): string {
  const date = parseDayKey(day);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/**
 * Day key of the Sunday starting the week containing `day`. Sunday start
 * matches US convention (the app defaults to lb; same audience call), and
 * hardcoding one convention keeps every strip/calendar/dot query consistent.
 */
export function startOfWeek(day: string): string {
  const date = parseDayKey(day);
  return addDays(day, -date.getDay());
}

/** The 7 day keys of the week starting at `weekStart` (a Sunday). */
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * Month grid for the calendar picker: 4–6 rows of 7 cells, padded with
 * `null` before day 1 and after the last day so every row is a full week
 * and the weekday columns line up. `month` is 1-based like the day keys.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(dayKey(new Date(year, month - 1, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** "August 2026" header for the calendar picker. */
export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function dayLabel(day: string): string {
  const today = todayKey();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return parseDayKey(day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
