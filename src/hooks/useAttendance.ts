import { useCallback, useEffect, useState } from 'react';
import {
  getAttendance,
  getAttendanceById,
  listAttendanceRange,
  monthDayMarks,
  type DayMark,
} from '../db/queries/attendance';
import type { Attendance, AttendanceWithEmployee } from '../types/attendance';
import { overviewStats, type OverviewStats } from '../db/queries/reports';
import { currentMonth, monthEnd, monthStart, today } from '../utils/date';
import { useCurrentUserId } from '../store/authStore';

export type MarksByDate = Record<string, DayMark>;

/**
 * Attendance dots for one month of the home calendar.
 * `reload` is exposed so the screen can refresh after returning from the
 * attendance form.
 */
export function useMonthMarks(month: string) {
  const [marks, setMarks] = useState<MarksByDate>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await monthDayMarks(monthStart(month), monthEnd(month));
      const next: MarksByDate = {};
      for (const row of rows) next[row.date] = row;
      setMarks(next);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { marks, loading, reload };
}

/** Today's headline numbers shown in the hero header. */
export function useOverview(date: string = today(), month: string = currentMonth()) {
  const userId = useCurrentUserId();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await overviewStats(date, month, userId));
    } finally {
      setLoading(false);
    }
  }, [date, month, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { stats, loading, reload };
}

/**
 * The row that already exists for one Saathi on one date, if any.
 *
 * The Hajari form uses it to say "this day is already marked as X" before the
 * user saves, because saving updates that row instead of adding a second one.
 */
export function useExistingEntry(empId: string | null, date: string | null) {
  const [entry, setEntry] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!empId || !date) {
      setEntry(null);
      return;
    }
    setLoading(true);
    try {
      setEntry(await getAttendance(empId, date));
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [empId, date]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { entry, loading, reload };
}

/**
 * Attendance rows for the Attendance List screen, over one date window.
 *
 * `from`/`to` are null while the user is still filling in a custom range; that
 * simply means "nothing to show yet" rather than an error, so the screen can
 * render the pickers without a failed query behind them.
 */
export function useAttendanceRange(from: string | null, to: string | null) {
  const userId = useCurrentUserId();
  const [entries, setEntries] = useState<AttendanceWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!from || !to) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await listAttendanceRange({ from, to, ownerId: userId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the attendance list');
    } finally {
      setLoading(false);
    }
  }, [from, to, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { entries, loading, error, reload };
}

/**
 * One attendance entry with its Saathi, for the Attendance Detail screen.
 *
 * A missing row is an error rather than an empty state: the only way to reach
 * this screen is the eye icon on a row that existed a moment ago, so it has
 * been deleted on another screen and saying so is more useful than a blank
 * form.
 */
export function useAttendanceDetail(id: string | null) {
  const [entry, setEntry] = useState<AttendanceWithEmployee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) {
      setEntry(null);
      setError('This attendance entry could not be found');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await getAttendanceById(id);
      setEntry(row);
      if (!row) setError('This attendance entry is no longer in your register');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this attendance entry');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { entry, loading, error, reload };
}
