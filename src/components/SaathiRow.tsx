import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, tints } from '../constants/colors';
import { radius, spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import type { Employee } from '../types/attendance';
import { employeeStatusLabel, initials, phoneUi, wageLabel } from '../utils/formatters';
import { toUi } from '../utils/date';

interface Props {
  employee: Employee;
  onPress?: (employee: Employee) => void;
  /** Hidden on the Working Saathi list, where every row is "Working". */
  showStatus?: boolean;
  /** Drops the divider on the last row so it does not float above the card edge. */
  last?: boolean;
}

/** One Saathi as a list row - shared by Working Saathi and All Saathi. */
export function SaathiRow({ employee, onPress, showStatus = false, last = false }: Props) {
  const working = employee.status === 'active';
  const tenure = [employee.start_date && toUi(employee.start_date), employee.end_date && toUi(employee.end_date)]
    .filter(Boolean)
    .join('  to  ');

  return (
    <Pressable
      onPress={onPress ? () => onPress(employee) : undefined}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        last && styles.rowLast,
        pressed && onPress ? styles.rowPressed : null,
      ]}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={employee.name + ', ' + wageLabel(employee.wage_amt, employee.wage_type)}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(employee.name)}</Text>
      </View>

      <View style={styles.main}>
        <Text style={styles.name} numberOfLines={1}>
          {employee.name}
        </Text>
        <Text style={styles.wage}>{wageLabel(employee.wage_amt, employee.wage_type)}</Text>

        {employee.phone ? (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="phone" size={13} color={colors.textSecondary} />
            <Text style={styles.meta}>{phoneUi(employee.phone)}</Text>
          </View>
        ) : null}

        {tenure ? (
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="calendar-range" size={13} color={colors.textSecondary} />
            <Text style={styles.meta}>{tenure}</Text>
          </View>
        ) : null}
      </View>

      {showStatus ? (
        <View style={[styles.chip, working ? styles.chipWorking : styles.chipNot]}>
          <Text style={[styles.chipText, { color: working ? colors.success : colors.textSecondary }]}>
            {employeeStatusLabel(employee.status)}
          </Text>
        </View>
      ) : null}

      {onPress ? (
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textDisabled} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowPressed: { backgroundColor: colors.primaryTint },

  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.bodyStrong, color: colors.primary },

  main: { flex: 1 },
  name: typography.bodyStrong,
  wage: { ...typography.caption, color: colors.primaryDark, fontWeight: '600', marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  meta: { ...typography.caption, fontSize: 12 },

  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chipWorking: { backgroundColor: tints.success },
  chipNot: { backgroundColor: tints.neutral },
  chipText: { fontSize: 12, fontWeight: '700' },
});
