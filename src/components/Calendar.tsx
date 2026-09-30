import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { radius, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import {
  WEEKDAY_LABELS,
  addMonths,
  buildCalendarGrid,
  currentMonth,
  isFuture,
  isToday,
  prettyMonth,
} from '../utils/date';
import type { MarksByDate } from '../hooks/useAttendance';

interface Props {
  month: string;
  marks: MarksByDate;
  selectedDate?: string | null;
  onSelectDate: (date: string) => void;
  onMonthChange: (month: string) => void;
  /** 0 = Sunday. Week-off columns are tinted so they read differently. */
  weekOffDays?: number[];
}

/**
 * Month grid for the home screen. Tapping any past-or-today date opens the
 * attendance form for that date; future dates cannot be marked so they are
 * disabled rather than hidden, which keeps the grid shape predictable.
 */
export function Calendar({
  month,
  marks,
  selectedDate,
  onSelectDate,
  onMonthChange,
  weekOffDays = [0],
}: Props) {
  const cells = useMemo(() => buildCalendarGrid(month), [month]);
  const atCurrentMonth = month >= currentMonth();

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          onPress={() => onMonthChange(addMonths(month, -1))}
          style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
        </Pressable>

        <Text style={styles.monthLabel}>{prettyMonth(month)}</Text>

        <Pressable
          onPress={() => !atCurrentMonth && onMonthChange(addMonths(month, 1))}
          disabled={atCurrentMonth}
          style={({ pressed }) => [
            styles.navBtn,
            pressed && styles.navBtnPressed,
            atCurrentMonth && styles.navBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <MaterialCommunityIcons
            name="chevron-right"
            size={28}
            color={atCurrentMonth ? colors.textDisabled : colors.primary}
          />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, i) => (
          <View key={`${label}-${i}`} style={styles.weekCell}>
            <Text
              style={[styles.weekLabel, weekOffDays.includes(i) && styles.weekLabelOff]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell, index) => {
          if (!cell.date) return <View key={`blank-${index}`} style={styles.cell} />;

          const mark = marks[cell.date];
          const disabled = isFuture(cell.date);
          const selected = selectedDate === cell.date;
          const todayCell = isToday(cell.date);
          const dotColor = !mark
            ? null
            : mark.absent > 0
              ? colors.error
              : mark.present > 0
                ? colors.success
                : colors.warning;

          return (
            <Pressable
              key={cell.date}
              style={styles.cell}
              disabled={disabled}
              onPress={() => onSelectDate(cell.date as string)}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              accessibilityLabel={`${cell.day} ${prettyMonth(month)}${
                mark ? `, ${mark.marked} marked` : ', not marked'
              }`}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.day,
                    todayCell && styles.dayToday,
                    selected && styles.daySelected,
                    pressed && !disabled && styles.dayPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      todayCell && styles.dayTextToday,
                      selected && styles.dayTextSelected,
                      disabled && styles.dayTextDisabled,
                    ]}
                  >
                    {cell.day}
                  </Text>
                  <View style={styles.dotRow}>
                    {dotColor ? (
                      <View style={[styles.dot, { backgroundColor: dotColor }]} />
                    ) : (
                      <View style={styles.dotPlaceholder} />
                    )}
                  </View>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        <LegendDot color={colors.success} label="All present" />
        <LegendDot color={colors.error} label="Someone absent" />
        <LegendDot color={colors.warning} label="Leave / off" />
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  navBtn: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  navBtnPressed: { backgroundColor: colors.primaryTint },
  navBtnDisabled: { opacity: 0.4 },
  monthLabel: { ...typography.h2, flex: 1, textAlign: 'center' },

  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  weekLabel: { ...typography.captionStrong, fontSize: 12 },
  weekLabelOff: { color: colors.secondary },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    padding: 2,
  },
  day: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayToday: { borderColor: colors.primary, backgroundColor: colors.surface },
  daySelected: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  dayPressed: { backgroundColor: colors.primaryTint },
  dayText: { ...typography.body, fontWeight: '600' },
  dayTextToday: { color: colors.primary, fontWeight: '700' },
  dayTextSelected: { color: colors.primaryDark, fontWeight: '700' },
  dayTextDisabled: { color: colors.textDisabled, fontWeight: '400' },

  dotRow: { height: 8, justifyContent: 'center', marginTop: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotPlaceholder: { width: 6, height: 6 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendText: typography.caption,
});
