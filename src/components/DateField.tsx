import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { radius, shadow, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import {
  WEEKDAY_LABELS,
  addMonths,
  buildCalendarGrid,
  currentMonth,
  fromUi,
  isToday,
  monthOf,
  prettyMonth,
  toUi,
  today,
  UI_DATE,
} from '../utils/date';

interface Props {
  /** Selected date in the fixed dd/mm/yyyy display format, or '' when empty. */
  value: string;
  /** Emits dd/mm/yyyy, or '' when the user clears the date. */
  onChange: (value: string) => void;
  /** Field name - used for the sheet title and accessibility. */
  title: string;
  placeholder?: string;
  invalid?: boolean;
  /** Read-only box: no calendar, no clear. Used when the date is derived. */
  disabled?: boolean;
  /** Bounds, also in dd/mm/yyyy. Days outside them cannot be tapped. */
  minDate?: string;
  maxDate?: string;
}

/**
 * Read-only text box that opens a month calendar - the "show calendar to select
 * date" control. Typing is deliberately impossible, so the value handed to the
 * form is always a real date in the dd/mm/yyyy format the spec fixes.
 */
export function DateField({
  value,
  onChange,
  title,
  placeholder = UI_DATE.toLowerCase(),
  invalid,
  disabled,
  minDate,
  maxDate,
}: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(fromUi(value) ?? today()));

  const selectedDb = fromUi(value);
  const minDb = fromUi(minDate);
  const maxDb = fromUi(maxDate);

  const openPicker = () => {
    // Always land on the month of the current value, not wherever the user
    // browsed to the last time the calendar was open.
    setMonth(monthOf(selectedDb ?? today()));
    setOpen(true);
  };

  const cells = useMemo(() => buildCalendarGrid(month), [month]);
  const outOfRange = (date: string) =>
    (minDb != null && date < minDb) || (maxDb != null && date > maxDb);

  const pick = (date: string) => {
    onChange(toUi(date));
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        style={({ pressed }) => [
          styles.box,
          invalid && styles.boxError,
          pressed && !disabled && styles.boxPressed,
          disabled && styles.boxDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: value || 'not set' }}
        accessibilityState={{ disabled: !!disabled }}
      >
        <MaterialCommunityIcons name="calendar-month" size={22} color={colors.primary} />
        <Text style={[styles.value, !value && styles.placeholder]}>{value || placeholder}</Text>
        {value && !disabled ? (
          <Pressable
            onPress={() => onChange('')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={'Clear ' + title}
          >
            <MaterialCommunityIcons name="close-circle" size={20} color={colors.textDisabled} />
          </Pressable>
        ) : null}
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel={'Close ' + title + ' calendar'}
        >
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{title}</Text>

            <View style={styles.navRow}>
              <Pressable
                onPress={() => setMonth(addMonths(month, -1))}
                style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <MaterialCommunityIcons name="chevron-left" size={28} color={colors.primary} />
              </Pressable>
              <Text style={styles.monthLabel}>{prettyMonth(month)}</Text>
              <Pressable
                onPress={() => setMonth(addMonths(month, 1))}
                style={({ pressed }) => [styles.navBtn, pressed && styles.navBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <MaterialCommunityIcons name="chevron-right" size={28} color={colors.primary} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAY_LABELS.map((label, i) => (
                <View key={label + i} style={styles.weekCell}>
                  <Text style={styles.weekLabel}>{label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((cell, index) => {
                if (!cell.date) return <View key={'blank-' + index} style={styles.cell} />;
                const date = cell.date;
                const disabled = outOfRange(date);
                const selected = selectedDb === date;

                return (
                  <Pressable
                    key={date}
                    style={styles.cell}
                    disabled={disabled}
                    onPress={() => pick(date)}
                    accessibilityRole="button"
                    accessibilityState={{ disabled, selected }}
                    accessibilityLabel={toUi(date)}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.day,
                          isToday(date) && styles.dayToday,
                          selected && styles.daySelected,
                          pressed && !disabled && styles.dayPressed,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            selected && styles.dayTextSelected,
                            disabled && styles.dayTextDisabled,
                          ]}
                        >
                          {cell.day}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footer}>
              <Pressable
                onPress={() => {
                  onChange('');
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.footerBtn, pressed && styles.footerBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel={'Clear ' + title}
              >
                <Text style={styles.footerText}>Clear</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const t = today();
                  // Today can sit outside the allowed range (e.g. a Kaam Till
                  // before today); jump to it rather than selecting it.
                  if (outOfRange(t)) {
                    setMonth(currentMonth());
                    return;
                  }
                  pick(t);
                }}
                style={({ pressed }) => [
                  styles.footerBtn,
                  styles.footerBtnPrimary,
                  pressed && styles.footerBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Use today"
              >
                <Text style={[styles.footerText, styles.footerTextPrimary]}>Today</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  boxError: { borderColor: colors.error },
  boxPressed: { backgroundColor: colors.primaryTint },
  boxDisabled: { backgroundColor: colors.background, opacity: 0.7 },
  value: { ...typography.body, flex: 1, letterSpacing: 0.3 },
  placeholder: { color: colors.textDisabled, letterSpacing: 0 },

  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.raised,
  },
  sheetTitle: { ...typography.h3, marginBottom: spacing.sm },

  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  navBtnPressed: { backgroundColor: colors.primaryTint },
  monthLabel: { ...typography.h3, flex: 1, textAlign: 'center' },

  weekRow: { flexDirection: 'row', marginTop: spacing.xs },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  weekLabel: { ...typography.captionStrong, fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.2857%', aspectRatio: 1, padding: 2 },
  day: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dayToday: { borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayPressed: { backgroundColor: colors.primaryTint },
  dayText: { ...typography.body, fontWeight: '600' },
  dayTextSelected: { color: colors.onColor, fontWeight: '700' },
  dayTextDisabled: { color: colors.textDisabled, fontWeight: '400' },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  footerBtnPressed: { opacity: 0.8 },
  footerText: { ...typography.button, fontSize: 15, color: colors.textSecondary },
  footerTextPrimary: { color: colors.onColor },
});
