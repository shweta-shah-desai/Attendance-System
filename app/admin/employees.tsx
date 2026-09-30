import React, { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  FieldError,
  Loader,
  OptionSheet,
  ScreenHeader,
  type SheetOption,
} from '../../src/components';
import { colors, tints } from '../../src/constants/colors';
import { radius, shadow, spacing, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import type { EmployeeFilter } from '../../src/db/queries/employees';
import { useAuth } from '../../src/hooks/useAuth';
import { useEmployees } from '../../src/hooks/useEmployees';
import type { Employee } from '../../src/types/attendance';
import { employeeStatusLabel, inr, phoneShort, truncate } from '../../src/utils/formatters';

type StatusTab = NonNullable<EmployeeFilter['status']>;
type SortKey = NonNullable<EmployeeFilter['sort']>;

const STATUS_TABS: Array<{ key: StatusTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Working' },
  { key: 'inactive', label: 'Not Working' },
];

const SORT_OPTIONS: ReadonlyArray<SheetOption<SortKey>> = [
  { value: 'name_asc', label: 'Name (A to Z)', icon: 'sort-alphabetical-ascending' },
  { value: 'name_desc', label: 'Name (Z to A)', icon: 'sort-alphabetical-descending' },
  { value: 'wage_desc', label: 'Amount (high to low)', icon: 'sort-numeric-descending' },
  { value: 'wage_asc', label: 'Amount (low to high)', icon: 'sort-numeric-ascending' },
  { value: 'recent', label: 'Recently added first', icon: 'clock-outline' },
];

/** Column widths - the table scrolls sideways rather than squeezing text. */
const COL = { name: 132, phone: 100, amount: 142, remarks: 148, view: 52 } as const;
/** Columns + the 4 gaps between them + the row's own side padding. */
const TABLE_WIDTH =
  COL.name +
  COL.phone +
  COL.amount +
  COL.remarks +
  COL.view +
  spacing.sm * 4 +
  spacing.md * 2;

/** Remarks are cut to 20 characters in this table, per the spec. */
const REMARKS_CHARS = 20;

/**
 * "All Saathi" - every Saathi created by the signed-in user.
 *
 * Name search + status filter + sort feed straight into the SQL query rather
 * than filtering in JS, so the list stays correct however long it grows. The
 * eye icon opens that Saathi's detail screen.
 */
export default function AllSaathiScreen() {
  const { status: authStatus } = useAuth();

  const [tab, setTab] = useState<StatusTab>('all');
  const [sort, setSort] = useState<SortKey>('name_asc');
  const [search, setSearch] = useState('');
  const [sortOpen, setSortOpen] = useState(false);

  const { employees, loading, error, reload } = useEmployees({ status: tab, search, sort });

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const openDetail = (employee: Employee) =>
    router.push({ pathname: '/admin/saathi/[id]', params: { id: String(employee.id) } });

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? '';

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="All Saathi"
        action={{
          icon: 'account-plus',
          label: 'Add new Saathi',
          onPress: () => router.push('/admin/new-saathi'),
          testID: 'header-add-saathi',
        }}
      />

      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search Saathi by name"
            placeholderTextColor={colors.textDisabled}
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search Saathi by name"
          />
          {search ? (
            <Pressable
              onPress={() => setSearch('')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <MaterialCommunityIcons name="close-circle" size={20} color={colors.textDisabled} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void reload()}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Status filter on the left, sort icon top-right of the list. */}
        <View style={styles.listToolbar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {STATUS_TABS.map((t) => {
              const active = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setTab(t.key)}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={'Show ' + t.label}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => setSortOpen(true)}
            style={({ pressed }) => [styles.sortBtn, pressed && styles.sortBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Sort the list"
            accessibilityValue={{ text: sortLabel }}
          >
            <MaterialCommunityIcons name="sort-variant" size={24} color={colors.primary} />
          </Pressable>
        </View>

        <Text style={styles.summaryLine}>
          {(employees.length === 1 ? '1 Saathi' : employees.length + ' Saathi') +
            '  •  ' +
            sortLabel}
        </Text>

        <View style={styles.tableCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ width: TABLE_WIDTH }}>
              <View style={styles.headRow}>
                <Text style={[styles.headCell, { width: COL.name }]}>Name</Text>
                <Text style={[styles.headCell, { width: COL.phone }]}>Phone</Text>
                <Text style={[styles.headCell, { width: COL.amount }]}>Amount(type)</Text>
                <Text style={[styles.headCell, { width: COL.remarks }]}>Remarks</Text>
                <Text style={[styles.headCell, styles.headCellCenter, { width: COL.view }]}>
                  View
                </Text>
              </View>

              {employees.map((emp, i) => (
                <Row key={emp.id} employee={emp} striped={i % 2 === 1} onView={openDetail} />
              ))}
            </View>
          </ScrollView>

          {loading && employees.length === 0 ? (
            <Loader label="Loading your Saathi..." />
          ) : error ? (
            <View style={styles.errorWrap}>
              <FieldError message={error} />
            </View>
          ) : employees.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="account-search-outline"
                size={40}
                color={colors.textDisabled}
              />
              <Text style={styles.emptyText}>
                {search
                  ? 'No Saathi matches "' + search + '".'
                  : tab === 'all'
                    ? 'No Saathi yet. Tap the + icon above to add your first one.'
                    : 'No Saathi is marked ' + (tab === 'active' ? 'Working' : 'Not Working') + '.'}
              </Text>
            </View>
          ) : null}
        </View>

        {employees.length > 0 ? (
          <Text style={styles.hint}>Swipe the table sideways to see all columns.</Text>
        ) : null}
      </ScrollView>

      <OptionSheet
        visible={sortOpen}
        title="Sort by"
        value={sort}
        options={SORT_OPTIONS}
        onSelect={setSort}
        onClose={() => setSortOpen(false)}
      />
    </View>
  );
}

interface RowProps {
  employee: Employee;
  striped: boolean;
  onView: (employee: Employee) => void;
}

/** One table row. The whole row opens the detail screen; so does the eye icon. */
function Row({ employee, striped, onView }: RowProps) {
  const working = employee.status === 'active';

  return (
    <Pressable
      onPress={() => onView(employee)}
      style={({ pressed }) => [
        styles.row,
        striped && styles.rowStriped,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        employee.name +
        ', ' +
        inr(employee.wage_amt) +
        ' ' +
        employee.wage_type +
        ', ' +
        employeeStatusLabel(employee.status)
      }
    >
      <View style={{ width: COL.name }}>
        <Text style={styles.nameText} numberOfLines={2}>
          {employee.name}
        </Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: working ? colors.success : colors.textDisabled }]} />
          <Text style={styles.statusText}>{employeeStatusLabel(employee.status)}</Text>
        </View>
      </View>

      <Text style={[styles.cell, styles.mono, { width: COL.phone }]} numberOfLines={1}>
        {phoneShort(employee.phone)}
      </Text>

      {/* Spec format: 1200(Monthly) - amount and type on one line. */}
      <Text style={[styles.cell, { width: COL.amount }]} numberOfLines={1}>
        <Text style={styles.amountText}>{inr(employee.wage_amt)}</Text>
        <Text style={styles.typeText}>{'(' + employee.wage_type + ')'}</Text>
      </Text>

      <Text style={[styles.cell, { width: COL.remarks }]} numberOfLines={1}>
        {truncate(employee.remarks, REMARKS_CHARS)}
      </Text>

      <View style={[styles.viewCell, { width: COL.view }]}>
        <Pressable
          onPress={() => onView(employee)}
          hitSlop={10}
          style={({ pressed }) => [styles.eyeBtn, pressed && styles.eyeBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={'View ' + employee.name}
        >
          <MaterialCommunityIcons name="eye" size={20} color={colors.primary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  searchWrap: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, height: '100%', fontSize: 16, color: colors.textPrimary },

  body: { padding: spacing.lg, paddingBottom: spacing.huge },

  listToolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { gap: spacing.sm, paddingRight: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipPressed: { opacity: 0.7 },
  chipText: { ...typography.captionStrong, fontSize: 14 },
  chipTextActive: { color: colors.primaryDark },

  sortBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sortBtnPressed: { backgroundColor: colors.primaryTint },

  summaryLine: {
    ...typography.caption,
    fontSize: 12,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  tableCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headCell: { ...typography.captionStrong, fontSize: 12, color: colors.primaryDark },
  headCellCenter: { textAlign: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowStriped: { backgroundColor: tints.neutral },
  rowPressed: { backgroundColor: colors.primaryTint },

  cell: { ...typography.caption, fontSize: 13, color: colors.textPrimary },
  mono: { letterSpacing: 0.3 },

  nameText: { ...typography.bodyStrong, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...typography.caption, fontSize: 11 },

  amountText: { ...typography.bodyStrong, fontSize: 13, color: colors.primaryDark },
  typeText: { ...typography.caption, fontSize: 12 },

  viewCell: { alignItems: 'center' },
  eyeBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  eyeBtnPressed: { backgroundColor: colors.border },

  errorWrap: { padding: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { ...typography.caption, textAlign: 'center', maxWidth: 260 },

  hint: { ...typography.caption, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
});
