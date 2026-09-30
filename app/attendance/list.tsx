import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  Card,
  DateField,
  Dropdown,
  Field,
  FieldError,
  Loader,
  ScreenHeader,
  type DropdownOption,
} from '../../src/components';
import { colors, tints } from '../../src/constants/colors';
import { radius, shadow, spacing, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { useAuth } from '../../src/hooks/useAuth';
import { deleteAttendance } from '../../src/db/queries/attendance';
import { useAttendanceRange } from '../../src/hooks/useAttendance';
import type { AttendanceWithEmployee } from '../../src/types/attendance';
import { fromUi, lastNDays, prettyDate, toUi, today } from '../../src/utils/date';
import { statusMeta } from '../../src/utils/formatters';

/** The filter combo values the spec fixes. */
type RangeKey = '7' | '30' | '90' | 'custom';

const RANGE_OPTIONS: ReadonlyArray<DropdownOption<RangeKey>> = [
  { value: '7', label: '7 Days', hint: 'Today and the six days before it', icon: 'calendar-week' },
  { value: '30', label: '30 Days', hint: 'The last month of entries', icon: 'calendar-month' },
  { value: '90', label: '90 Days', hint: 'The last three months', icon: 'calendar-range' },
  {
    value: 'custom',
    label: 'Custom Date',
    hint: 'Pick your own From and To dates',
    icon: 'calendar-edit',
  },
];

/** The window the screen opens on, and what Custom Date starts from. */
const DEFAULT_DAYS = 7;

/**
 * Column widths - Name takes the slack so long names stay readable. The three
 * fixed columns plus the gaps have to leave it something at 440pt wide, which
 * is what keeps these numbers as small as they are.
 */
const COL = { date: 80, status: 98, actions: 74 } as const;

/**
 * "Attendance List" - every attendance entry inside a date window.
 *
 * Columns are Date, Name and Status, plus per-row View and Delete. The window
 * comes from the filter combo (7 / 30 / 90 days, or a custom From-To pair) and
 * the rows arrive already sorted by date with the latest first, which is the
 * default the spec asks for.
 */
export default function AttendanceListScreen() {
  const { status: authStatus } = useAuth();

  const [range, setRange] = useState<RangeKey>(String(DEFAULT_DAYS) as RangeKey);
  // Custom Date opens on the same window as the default 7 Days filter, so
  // switching to it shows the list the user was already looking at.
  const [fromText, setFromText] = useState(() => toUi(lastNDays(DEFAULT_DAYS).from));
  const [toText, setToText] = useState(() => toUi(today()));

  const customFrom = fromUi(fromText);
  const customTo = fromUi(toText);

  /** A custom range is only usable once both ends are picked, in order. */
  const customReady =
    range !== 'custom' || (!!customFrom && !!customTo && customFrom <= customTo);

  /**
   * Nothing is wrong with an untouched custom range - the user has simply not
   * picked the dates yet - so the red error waits until one end is filled in.
   */
  const customError = useMemo(() => {
    if (range !== 'custom' || customReady) return '';
    if (customFrom && customTo) return 'The From date cannot be after the To date.';
    if (customFrom || customTo) return 'Pick both a From date and a To date.';
    return '';
  }, [range, customReady, customFrom, customTo]);

  // A half-filled custom range asks for nothing rather than for everything.
  const span = useMemo(
    () =>
      range === 'custom'
        ? customReady
          ? { from: customFrom, to: customTo }
          : { from: null, to: null }
        : lastNDays(Number(range)),
    [range, customReady, customFrom, customTo],
  );

  const { entries, loading, error, reload } = useAttendanceRange(span.from, span.to);

  // The row awaiting a yes/no on permanent delete, and what came of the last one.
  const [pending, setPending] = useState<AttendanceWithEmployee | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    [],
  );

  const openDetail = (entry: AttendanceWithEmployee) =>
    router.push({ pathname: '/attendance/[id]', params: { id: String(entry.id) } });

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAttendance(pending.id);
      const gone = pending.emp_name + ' on ' + toUi(pending.date);
      setPending(null);
      // Back to the list, minus the row that was just removed.
      await reload();
      setDeleted(gone + ' has been deleted.');
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(() => setDeleted(null), 5000);
    } catch (e) {
      setDeleteError(
        e instanceof Error && e.message
          ? 'Could not delete: ' + e.message
          : 'Could not delete this entry. Please try again.',
      );
    } finally {
      setDeleting(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? '';
  const subtitle =
    span.from && span.to
      ? prettyDate(span.from) + '  to  ' + prettyDate(span.to)
      : 'Pick a date range';

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Attendance List"
        subtitle={subtitle}
        action={{
          icon: 'calendar-plus',
          label: 'Add attendance',
          onPress: () => router.push('/attendance/manual-entry'),
          testID: 'header-add-attendance',
        }}
      />

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void reload()}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {deleted ? (
          <View style={styles.successBanner}>
            <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
            <Text style={styles.successText}>{deleted}</Text>
            <Pressable
              onPress={() => setDeleted(null)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Hide message"
            >
              <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        ) : null}

        {/* The combo sits beside the heading rather than under its own label -
            at 440pt wide that keeps the whole filter to a single row. */}
        <Card
          title="Filter"
          subtitle="Latest date first"
          right={
            <View style={styles.periodBox}>
              <Dropdown
                compact
                title="Period"
                value={range}
                options={RANGE_OPTIONS}
                onChange={setRange}
              />
            </View>
          }
        >
          {range === 'custom' ? (
            <>
              <Field label="From date" required>
                <DateField
                  title="From date"
                  value={fromText}
                  onChange={setFromText}
                  invalid={!!customError && (!customFrom || !!customTo)}
                />
              </Field>

              <Field label="To date" required>
                <DateField
                  title="To date"
                  value={toText}
                  onChange={setToText}
                  invalid={!!customError && !!customFrom && !customTo}
                />
              </Field>

              {customError ? <FieldError message={customError} /> : null}
            </>
          ) : null}
        </Card>

        <Text style={styles.summaryLine}>
          {(entries.length === 1 ? '1 entry' : entries.length + ' entries') + '  •  ' + rangeLabel}
        </Text>

        <View style={styles.tableCard}>
          <View style={styles.headRow}>
            <Text style={[styles.headCell, { width: COL.date }]}>Date</Text>
            <Text style={[styles.headCell, styles.flexCell]}>Name</Text>
            <Text style={[styles.headCell, { width: COL.status }]}>Status</Text>
            <Text style={[styles.headCell, styles.headCellCenter, { width: COL.actions }]}>
              Action
            </Text>
          </View>

          {entries.map((entry, i) => (
            <Row
              key={entry.id}
              entry={entry}
              striped={i % 2 === 1}
              onView={openDetail}
              onDelete={setPending}
            />
          ))}

          {loading && entries.length === 0 ? (
            <Loader label="Loading attendance..." />
          ) : error ? (
            <View style={styles.errorWrap}>
              <FieldError message={error} />
              <Pressable
                onPress={() => void reload()}
                style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                accessibilityRole="button"
                accessibilityLabel="Try loading the attendance list again"
              >
                <Text style={styles.linkText}>Try again</Text>
              </Pressable>
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name="calendar-blank-outline"
                size={40}
                color={colors.textDisabled}
              />
              <Text style={styles.emptyText}>
                {customReady
                  ? 'No attendance was marked in this period.'
                  : 'Choose a From and a To date to see entries.'}
              </Text>
              {!customReady ? null : (
                <Pressable
                  onPress={() => router.push('/attendance/manual-entry')}
                  style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                  accessibilityRole="link"
                  accessibilityLabel="Go to Hajari to mark attendance"
                >
                  <Text style={styles.linkText}>Mark attendance</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <ConfirmDelete
        entry={pending}
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setPending(null);
          setDeleteError(null);
        }}
      />
    </View>
  );
}

interface RowProps {
  entry: AttendanceWithEmployee;
  striped: boolean;
  onView: (entry: AttendanceWithEmployee) => void;
  onDelete: (entry: AttendanceWithEmployee) => void;
}

/**
 * One table row: the date, who it is for, how the day was marked, and the two
 * per-row actions. The whole row opens the detail screen as well as the eye,
 * which is how the All Saathi table already behaves.
 */
function Row({ entry, striped, onView, onDelete }: RowProps) {
  const meta = statusMeta[entry.status];
  const description = toUi(entry.date) + ', ' + entry.emp_name + ', ' + meta.label;

  return (
    <Pressable
      onPress={() => onView(entry)}
      style={({ pressed }) => [
        styles.row,
        striped && styles.rowStriped,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={description}
    >
      <Text style={[styles.dateText, { width: COL.date }]} numberOfLines={1}>
        {toUi(entry.date)}
      </Text>

      <Text style={[styles.nameText, styles.flexCell]} numberOfLines={2}>
        {entry.emp_name}
      </Text>

      <View style={[styles.statusCell, { width: COL.status }]}>
        <View style={[styles.pill, { backgroundColor: meta.tint }]}>
          <MaterialCommunityIcons name={meta.icon as never} size={14} color={meta.color} />
          <Text style={[styles.pillText, { color: meta.color }]} numberOfLines={1}>
            {meta.label}
          </Text>
        </View>
      </View>

      <View style={[styles.actionCell, { width: COL.actions }]}>
        <Pressable
          onPress={() => onView(entry)}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={'View ' + description}
        >
          <MaterialCommunityIcons name="eye" size={18} color={colors.primary} />
        </Pressable>

        <Pressable
          onPress={() => onDelete(entry)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            styles.iconBtnDanger,
            pressed && styles.iconBtnDangerPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={'Delete ' + description}
        >
          <MaterialCommunityIcons name="delete" size={18} color={colors.error} />
        </Pressable>
      </View>
    </Pressable>
  );
}

interface ConfirmProps {
  entry: AttendanceWithEmployee | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Permanent-delete confirmation.
 *
 * It names the entry being removed and says the word "permanently", because
 * there is no undo and no bin to fish it back out of - Cancel is the default
 * position, so the destructive button is the one that has to be aimed at.
 */
function ConfirmDelete({ entry, busy, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      transparent
      visible={!!entry}
      animationType="fade"
      onRequestClose={busy ? () => {} : onCancel}
    >
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <View style={styles.dialogIcon}>
            <MaterialCommunityIcons name="delete-alert" size={28} color={colors.error} />
          </View>

          <Text style={styles.dialogTitle}>Delete this attendance?</Text>
          <Text style={styles.dialogBody}>
            {entry
              ? entry.emp_name +
                ' on ' +
                toUi(entry.date) +
                ' will be deleted permanently. This cannot be undone.'
              : ''}
          </Text>

          {error ? <FieldError message={error} /> : null}

          <View style={styles.dialogActions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [
                styles.dialogBtn,
                styles.dialogBtnGhost,
                pressed && styles.dialogBtnPressed,
                busy && styles.dialogBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Keep this entry"
            >
              <Text style={styles.dialogBtnGhostText}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.dialogBtn,
                styles.dialogBtnDanger,
                pressed && styles.dialogBtnPressed,
                busy && styles.dialogBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete this entry permanently"
              testID="confirm-delete"
            >
              <Text style={styles.dialogBtnDangerText}>
                {busy ? 'Deleting...' : 'Delete'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  body: { padding: spacing.lg, paddingBottom: spacing.huge },

  /** Wide enough for "Custom Date" and the chevron, and no wider. */
  periodBox: { width: 148 },

  summaryLine: {
    ...typography.caption,
    fontSize: 12,
    marginTop: spacing.lg,
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
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.primaryTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headCell: { ...typography.captionStrong, fontSize: 12, color: colors.primaryDark },
  headCellCenter: { textAlign: 'center' },
  flexCell: { flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowStriped: { backgroundColor: tints.neutral },
  rowPressed: { backgroundColor: colors.primaryTint },

  dateText: { ...typography.caption, fontSize: 12, color: colors.textPrimary, letterSpacing: 0.2 },
  nameText: { ...typography.bodyStrong, fontSize: 15 },

  statusCell: { alignItems: 'flex-start' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillText: { ...typography.captionStrong, fontSize: 12 },

  actionCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  iconBtnPressed: { backgroundColor: colors.border },
  iconBtnDanger: { backgroundColor: tints.error },
  iconBtnDangerPressed: { backgroundColor: colors.border },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: tints.success,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  successText: { ...typography.captionStrong, color: colors.success, flex: 1, fontSize: 14 },

  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.raised,
  },
  dialogIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: tints.error,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  dialogTitle: { ...typography.h3, textAlign: 'center' },
  dialogBody: {
    ...typography.body,
    fontSize: 15,
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  dialogActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  dialogBtn: {
    flex: 1,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  dialogBtnPressed: { opacity: 0.8 },
  dialogBtnDisabled: { opacity: 0.5 },
  dialogBtnGhost: { backgroundColor: colors.surface, borderColor: colors.border },
  dialogBtnGhostText: { ...typography.button, fontSize: 15, color: colors.textSecondary },
  dialogBtnDanger: { backgroundColor: colors.error, borderColor: colors.error },
  dialogBtnDangerText: { ...typography.button, fontSize: 15, color: colors.onColor },

  errorWrap: { padding: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { ...typography.caption, textAlign: 'center', maxWidth: 260 },

  link: { marginTop: spacing.sm, alignSelf: 'center' },
  linkPressed: { opacity: 0.6 },
  linkText: {
    ...typography.captionStrong,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
