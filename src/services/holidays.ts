/**
 * Public holiday list, fetched from Google Calendar and stored on the device.
 *
 * Two transports, in order of preference:
 *
 *  1. The Calendar API, when EXPO_PUBLIC_GOOGLE_CALENDAR_API_KEY is set. It
 *     takes an explicit date window, so asking for one year returns exactly
 *     that year.
 *  2. The calendar's public .ics feed, which needs no key at all. This is the
 *     default so the feature works with zero configuration, but the feed
 *     carries a rolling window rather than a year, so January can be missing
 *     if the app is first opened late in the year. Set the API key if the list
 *     has to be complete for the whole year.
 *
 * Nothing here is written to Supabase. A holiday list is a public calendar,
 * not the user's data - there is nothing to back up, and a device that does
 * not have it just asks Google again.
 */
import { countHolidays, listHolidays, replaceYear } from '../db/queries/holidays';
import { getSetting, setSetting } from '../db/queries/settings';
import type { Holiday } from '../types/attendance';
import { nowStamp } from '../utils/date';

/** Indian public holidays. Override to ship a different region's list. */
const CALENDAR_ID =
  process.env.EXPO_PUBLIC_HOLIDAY_CALENDAR_ID ?? 'en.indian#holiday@group.v.calendar.google.com';
const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_CALENDAR_API_KEY ?? '';

const FETCHED_AT_KEY = 'holidays.fetched_at';
const FETCHED_YEAR_KEY = 'holidays.year';
const REGION = 'IN';
/** A holiday list is never worth blocking a screen on for long. */
const TIMEOUT_MS = 15000;

export interface HolidayRow {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface HolidayLoad {
  rows: Holiday[];
  /** Where this list came from, so the screen can say so. */
  source: 'stored' | 'google';
  fetchedAt: string | null;
  /** Set when the network attempt failed but a stored list was shown anyway. */
  warning?: string;
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Calendar replied ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Google Calendar replied ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pulls the all-day events out of a Calendar API response.
 *
 * Exported for the test harness - the parsers are the only part of this file
 * worth testing without a network.
 */
export function parseApiEvents(payload: unknown, year: number): HolidayRow[] {
  const items = (payload as { items?: unknown[] })?.items ?? [];
  const rows: HolidayRow[] = [];

  for (const raw of items) {
    const item = raw as { summary?: string; start?: { date?: string; dateTime?: string } };
    const date = (item.start?.date ?? item.start?.dateTime ?? '').slice(0, 10);
    const name = (item.summary ?? '').trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!date.startsWith(`${year}-`)) continue;
    rows.push({ date, name });
  }
  return dedupe(rows);
}

/**
 * Pulls the all-day events out of an .ics feed.
 *
 * iCalendar folds long lines by continuing them on the next line with a
 * leading space, so the text has to be unfolded before anything is read out of
 * it - otherwise a long holiday name arrives truncated.
 */
export function parseIcs(ics: string, year: number): HolidayRow[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const rows: HolidayRow[] = [];

  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const event = block.split('END:VEVENT')[0];

    // DTSTART;VALUE=DATE:20260126, or DTSTART:20260126T000000Z
    const start = /^DTSTART[^:\r\n]*:(\d{8})/m.exec(event);
    const summary = /^SUMMARY[^:\r\n]*:(.*)$/m.exec(event);
    if (!start || !summary) continue;

    const stamp = start[1];
    const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    if (!date.startsWith(`${year}-`)) continue;

    // iCalendar escapes commas, semicolons and newlines inside a value.
    const name = summary[1]
      .replace(/\\n/gi, ' ')
      .replace(/\\([,;\\])/g, '$1')
      .trim();
    if (!name) continue;

    rows.push({ date, name });
  }
  return dedupe(rows);
}

/**
 * One row per date, earliest first. The calendar lists some observances on the
 * same day as the holiday itself, and `holidays.date` is UNIQUE, so the first
 * name for a date is the one kept.
 */
function dedupe(rows: HolidayRow[]): HolidayRow[] {
  const byDate = new Map<string, HolidayRow>();
  for (const row of rows) if (!byDate.has(row.date)) byDate.set(row.date, row);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Fetches one year from Google. Throws if neither transport works. */
export async function fetchHolidays(year: number): Promise<HolidayRow[]> {
  const calendar = encodeURIComponent(CALENDAR_ID);

  if (API_KEY) {
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events` +
      `?key=${encodeURIComponent(API_KEY)}` +
      `&timeMin=${year}-01-01T00:00:00Z&timeMax=${year + 1}-01-01T00:00:00Z` +
      '&singleEvents=true&orderBy=startTime&maxResults=2500';
    const rows = parseApiEvents(await getJson(url), year);
    if (rows.length > 0) return rows;
    // An empty result from a working key means the window really is empty;
    // fall through to the feed rather than storing nothing.
  }

  const icsUrl = `https://calendar.google.com/calendar/ical/${calendar}/public/basic.ics`;
  return parseIcs(await getText(icsUrl), year);
}

/**
 * The screen's one entry point: returns this year's holidays, fetching them
 * only when they are not already on the device.
 *
 * That "only when missing" is what covers a logout, a crash, a reinstall and a
 * new phone - all four look identical from here, namely an empty table - while
 * costing no network call on an ordinary open. `force` is pull-to-refresh.
 */
export async function loadHolidays(
  year: number,
  options: { force?: boolean } = {},
): Promise<HolidayLoad> {
  const stored = await countHolidays(year);
  const fetchedYear = await getSetting(FETCHED_YEAR_KEY);
  const needsFetch = options.force || stored === 0 || fetchedYear !== String(year);

  if (!needsFetch) {
    return {
      rows: await listHolidays(year),
      source: 'stored',
      fetchedAt: await getSetting(FETCHED_AT_KEY),
    };
  }

  try {
    const fetched = await fetchHolidays(year);
    if (fetched.length === 0) throw new Error('Google Calendar returned no holidays');

    await replaceYear(
      year,
      fetched.map((r) => ({ ...r, region: REGION })),
    );
    const at = nowStamp();
    await setSetting(FETCHED_AT_KEY, at);
    await setSetting(FETCHED_YEAR_KEY, String(year));
    return { rows: await listHolidays(year), source: 'google', fetchedAt: at };
  } catch (e) {
    // A stored list is still worth showing; only a first-ever load has nothing
    // to fall back on, and the screen turns that into a retry prompt.
    const rows = await listHolidays(year);
    if (rows.length === 0) throw e;
    return {
      rows,
      source: 'stored',
      fetchedAt: await getSetting(FETCHED_AT_KEY),
      warning: 'Could not reach Google just now - showing the saved list.',
    };
  }
}
