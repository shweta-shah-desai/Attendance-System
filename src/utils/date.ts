import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import weekday from 'dayjs/plugin/weekday';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(weekday);

/** Storage format used everywhere in SQLite. */
export const DB_DATE = 'YYYY-MM-DD';
/** Display format the spec fixes for every date shown to the user. */
export const UI_DATE = 'DD/MM/YYYY';
export const DB_MONTH = 'YYYY-MM';

export const today = (): string => dayjs().format(DB_DATE);
export const nowIso = (): string => dayjs().toISOString();
export const nowTime = (): string => dayjs().format('HH:mm');

export const toDb = (d: Dayjs | Date | string): string => dayjs(d).format(DB_DATE);

/** "2026-09-24" -> "24/09/2026". Returns '' for empty/invalid input. */
export const toUi = (d?: string | null): string =>
  d && dayjs(d, DB_DATE, true).isValid() ? dayjs(d, DB_DATE).format(UI_DATE) : '';

/** "24/09/2026" -> "2026-09-24". Returns null when the text is not a real date. */
export const fromUi = (s?: string | null): string | null => {
  if (!s) return null;
  const parsed = dayjs(s, UI_DATE, true);
  return parsed.isValid() ? parsed.format(DB_DATE) : null;
};

export const prettyDate = (d: string): string => dayjs(d).format('ddd, DD MMM YYYY');
export const prettyMonth = (m: string): string => dayjs(`${m}-01`).format('MMMM YYYY');
export const monthOf = (d: string): string => dayjs(d).format(DB_MONTH);
export const currentMonth = (): string => dayjs().format(DB_MONTH);

export const addMonths = (month: string, delta: number): string =>
  dayjs(`${month}-01`).add(delta, 'month').format(DB_MONTH);

export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string =>
  dayjs(`${month}-01`).endOf('month').format(DB_DATE);
export const daysInMonth = (month: string): number => dayjs(`${month}-01`).daysInMonth();

export const addDays = (d: string, delta: number): string =>
  dayjs(d, DB_DATE).add(delta, 'day').format(DB_DATE);

/**
 * Inclusive window of the last `days` days, ending on `end` (today by default).
 * "7 days" therefore means today plus the six days before it, not eight days.
 */
export const lastNDays = (
  days: number,
  end: string = today(),
): { from: string; to: string } => ({ from: addDays(end, -(days - 1)), to: end });

/** The calendar month before the current one, as YYYY-MM. */
export const previousMonth = (): string => addMonths(currentMonth(), -1);

/**
 * Every date from `from` to `to`, inclusive - what Auto Hajari walks over to
 * write one attendance row per day. A backwards pair yields nothing rather
 * than looping forever.
 */
export const listDates = (from: string, to: string): string[] => {
  const start = dayjs(from, DB_DATE, true);
  const end = dayjs(to, DB_DATE, true);
  if (!start.isValid() || !end.isValid() || end.isBefore(start, 'day')) return [];
  const out: string[] = [];
  for (let d = start; d.isSameOrBefore(end, 'day'); d = d.add(1, 'day')) {
    out.push(d.format(DB_DATE));
  }
  return out;
};

export const isFuture = (d: string): boolean => dayjs(d, DB_DATE).isAfter(dayjs(), 'day');
export const isToday = (d: string): boolean => d === today();

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (d: string): number => dayjs(d, DB_DATE).day();
export const isWeekend = (d: string, weekOffDays: number[] = [0]): boolean =>
  weekOffDays.includes(weekdayOf(d));

export const listMonthDates = (month: string): string[] => {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) =>
    dayjs(`${month}-01`).date(i + 1).format(DB_DATE),
  );
};

export interface CalendarCell {
  date: string | null; // null = leading blank before the 1st
  day: number | null;
}

/**
 * Month laid out as calendar rows starting on Sunday, padded with nulls so the
 * grid always renders 7 columns.
 */
export const buildCalendarGrid = (month: string): CalendarCell[] => {
  const first = dayjs(`${month}-01`);
  const lead = first.day(); // 0..6
  const total = first.daysInMonth();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ date: null, day: null });
  for (let d = 1; d <= total; d += 1) {
    cells.push({ date: first.date(d).format(DB_DATE), day: d });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
};

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Inclusive difference in days, used for tenure text. */
export const daysBetween = (from: string, to: string): number =>
  dayjs(to, DB_DATE).diff(dayjs(from, DB_DATE), 'day') + 1;

export const greeting = (): string => {
  const h = dayjs().hour();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

export default dayjs;
