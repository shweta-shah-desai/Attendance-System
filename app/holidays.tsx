import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Card, FieldError, Loader, ScreenHeader } from '../src/components';
import { colors, tints } from '../src/constants/colors';
import { radius, spacing } from '../src/constants/spacing';
import { typography } from '../src/constants/typography';
import { useAuth } from '../src/hooks/useAuth';
import { loadHolidays } from '../src/services/holidays';
import type { Holiday } from '../src/types/attendance';
import {
  currentYear,
  dayOfMonth,
  isToday,
  monthOf,
  prettyMonth,
  sinceStamp,
  today,
  weekdayShort,
} from '../src/utils/date';

interface MonthGroup {
  month: string; // YYYY-MM
  rows: Holiday[];
}

/**
 * "Holidays" - this year's public holiday list, from Google Calendar.
 *
 * The list is stored on the device and only re-fetched when it is missing, so
 * an ordinary open costs no network call. A logout, a crash, a reinstall and a
 * new phone all look the same from here - an empty table - which is exactly
 * when a fetch is wanted. Pull down to force a refresh.
 *
 * Only the current year is kept; opening the app in January replaces last
 * year's list rather than accumulating.
 */
export default function HolidaysScreen() {
  const { status: authStatus } = useAuth();
  const year = currentYear();

  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean) => {
      setError(null);
      setWarning(null);
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await loadHolidays(year, { force });
        setRows(result.rows);
        setFetchedAt(result.fetchedAt);
        setWarning(result.warning ?? null);
      } catch (e) {
        // Only reachable with nothing stored - loadHolidays falls back to the
        // saved list whenever it has one.
        setError(
          e instanceof Error && e.message
            ? 'Could not get the holiday list: ' + e.message
            : 'Could not get the holiday list. Please check your connection.',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [year],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /** Grouped by month so the year reads as a calendar, not a flat list. */
  const groups = useMemo<MonthGroup[]>(() => {
    const byMonth = new Map<string, Holiday[]>();
    for (const row of rows) {
      const key = monthOf(row.date);
      const list = byMonth.get(key);
      if (list) list.push(row);
      else byMonth.set(key, [row]);
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, list]) => ({ month, rows: list }));
  }, [rows]);

  const upcoming = useMemo(() => rows.filter((r) => r.date >= today()).length, [rows]);

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Holidays"
        subtitle={String(year)}
        action={{
          icon: 'refresh',
          label: 'Get the latest list from Google',
          onPress: () => void load(true),
          testID: 'holidays-refresh',
        }}
      />

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {loading && rows.length === 0 ? (
          <Loader label="Getting this year's holidays..." />
        ) : error ? (
          <Card>
            <FieldError message={error} />
            <Pressable
              onPress={() => void load(true)}
              style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <MaterialCommunityIcons name="refresh" size={18} color={colors.primary} />
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.summary}>
                <MaterialCommunityIcons name="calendar-star" size={26} color={colors.primary} />
                <View style={styles.summaryText}>
                  <Text style={styles.summaryTitle}>
                    {rows.length} {rows.length === 1 ? 'holiday' : 'holidays'} in {year}
                  </Text>
                  <Text style={styles.summarySub}>
                    {upcoming > 0 ? `${upcoming} still to come` : 'All done for this year'}
                    {fetchedAt ? ` - updated ${sinceStamp(fetchedAt)}` : ''}
                  </Text>
                </View>
              </View>
              {warning ? (
                <View style={styles.warnRow}>
                  <MaterialCommunityIcons
                    name="cloud-off-outline"
                    size={16}
                    color={colors.warning}
                  />
                  <Text style={styles.warnText}>{warning}</Text>
                </View>
              ) : null}
            </Card>

            {rows.length === 0 ? (
              <Card>
                <Text style={styles.empty}>
                  No holidays are stored for {year} yet. Pull down to fetch them.
                </Text>
              </Card>
            ) : (
              groups.map((group) => (
                <Card key={group.month} title={prettyMonth(group.month)} padded={false}>
                  {group.rows.map((row, index) => {
                    const past = row.date < today();
                    const isTodayRow = isToday(row.date);
                    return (
                      <View
                        key={row.date}
                        style={[styles.row, index > 0 && styles.rowDivider]}
                        accessibilityLabel={`${row.name} on ${row.date}`}
                      >
                        <View
                          style={[
                            styles.dateBox,
                            isTodayRow && styles.dateBoxToday,
                            past && !isTodayRow && styles.dateBoxPast,
                          ]}
                        >
                          <Text style={[styles.dateDay, isTodayRow && styles.dateTodayText]}>
                            {dayOfMonth(row.date)}
                          </Text>
                          <Text style={[styles.dateWeekday, isTodayRow && styles.dateTodayText]}>
                            {weekdayShort(row.date)}
                          </Text>
                        </View>
                        <Text
                          style={[styles.holidayName, past && !isTodayRow && styles.pastText]}
                          numberOfLines={2}
                        >
                          {row.name}
                        </Text>
                        {isTodayRow ? (
                          <View style={styles.todayChip}>
                            <Text style={styles.todayChipText}>Today</Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </Card>
              ))
            )}

            <Text style={styles.footnote}>
              Public holiday dates come from Google Calendar and are kept on this phone only.
              Regional and company holidays are not included - mark those as Hajari yourself.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryText: { flex: 1 },
  summaryTitle: { ...typography.bodyStrong },
  summarySub: { ...typography.caption, marginTop: 2 },

  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: tints.warning,
  },
  warnText: { ...typography.caption, color: colors.warning, flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },

  dateBox: {
    width: 48,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
  },
  dateBoxToday: { backgroundColor: colors.primary },
  dateBoxPast: { backgroundColor: colors.background },
  dateDay: { ...typography.bodyStrong, color: colors.primaryDark, fontSize: 18 },
  dateWeekday: { ...typography.caption, color: colors.primaryDark, fontSize: 11 },
  dateTodayText: { color: colors.onColor },

  holidayName: { ...typography.body, flex: 1 },
  pastText: { color: colors.textSecondary },

  todayChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  todayChipText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },

  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },

  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  retryPressed: { opacity: 0.6 },
  retryText: { ...typography.button, color: colors.primary },

  footnote: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
});
