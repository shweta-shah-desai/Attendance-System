import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { radius, spacing, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { updateAttendance } from '../../src/db/queries/attendance';
import { useAuth } from '../../src/hooks/useAuth';
import { useAttendanceDetail } from '../../src/hooks/useAttendance';
import { useEmployees } from '../../src/hooks/useEmployees';
import type { AttendanceStatus } from '../../src/types/attendance';
import { fromUi, isFuture, prettyDate, toUi, today } from '../../src/utils/date';
import { employeeStatusLabel, statusMeta } from '../../src/utils/formatters';
import { HAJARI_STATUSES } from '../../src/utils/validators';

/**
 * Present / Absent, plus whatever this row already is.
 *
 * The everyday form only offers two statuses, but a row may carry one of the
 * others (Leave, Holiday...). Dropping it from the list would silently rewrite
 * the entry the moment someone opened update mode, so the current value is
 * always kept as a choice.
 */
const statusOptions = (current: AttendanceStatus): ReadonlyArray<DropdownOption<AttendanceStatus>> => {
  const values: AttendanceStatus[] = HAJARI_STATUSES.includes(current as never)
    ? [...HAJARI_STATUSES]
    : [...HAJARI_STATUSES, current];
  return values.map((s) => ({
    value: s,
    label: statusMeta[s].label,
    hint: statusMeta[s].hint,
    icon: statusMeta[s].icon,
  }));
};

/**
 * "Attendance Detail" - one entry, shown as a form.
 *
 * It opens read-only; the pencil beside the title switches it into update
 * mode. Save and Cancel are always on screen and simply disabled while the
 * page is read-only, so both modes are the same shape rather than having
 * buttons appear and disappear under the user's thumb.
 */
export default function AttendanceDetailScreen() {
  const { status: authStatus } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : null;

  const { entry, loading, error, reload } = useAttendanceDetail(id);
  const { employees } = useEmployees({ status: 'all', sort: 'name_asc' });

  const [editing, setEditing] = useState(false);
  const [empIdText, setEmpIdText] = useState('');
  const [dateUi, setDateUi] = useState('');
  const [status, setStatus] = useState<AttendanceStatus>('Present');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Puts the draft back to whatever is stored - used on load and on Cancel. */
  const resetDraft = useCallback(() => {
    if (!entry) return;
    setEmpIdText(String(entry.emp_id));
    setDateUi(toUi(entry.date));
    setStatus(entry.status);
    setSaveError(null);
  }, [entry]);

  useEffect(() => {
    resetDraft();
  }, [resetDraft]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const empOptions = useMemo<ReadonlyArray<DropdownOption<string>>>(
    () =>
      employees.map((e) => ({
        value: String(e.id),
        label: e.name,
        hint: employeeStatusLabel(e.status),
        icon: 'account',
      })),
    [employees],
  );

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const dateDb = fromUi(dateUi);

  /** Why Save cannot run right now, or '' when it can. */
  const draftError = !empIdText
    ? 'Choose a Saathi.'
    : !dateDb
      ? 'Choose a date.'
      : isFuture(dateDb)
        ? 'You cannot mark attendance for a future date.'
        : '';

  const onSave = async () => {
    if (!entry || !dateDb || !empIdText) return;
    if (draftError) {
      setSaveError(draftError);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await updateAttendance(entry.id, {
        emp_id: Number(empIdText),
        date: dateDb,
        status,
      });
      setEditing(false);
      // Straight back to the list, which reloads on focus and so already shows
      // the change. Going back rather than replacing keeps the filter the user
      // was browsing with.
      if (router.canGoBack()) router.back();
      else router.replace('/attendance/list');
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? e.message
          : 'Could not save these changes. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    resetDraft();
    setEditing(false);
  };

  const meta = statusMeta[status];
  const chosen = employees.find((e) => String(e.id) === empIdText);
  // Before the Saathi list arrives, the joined name on the entry is the one
  // thing we know for certain.
  const saathiName = chosen?.name ?? entry?.emp_name ?? '-';
  const saathiStatus = chosen?.status ?? entry?.emp_status;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Attendance Detail"
        subtitle={editing ? 'Update mode' : 'View only'}
        action={
          editing || !entry
            ? undefined
            : {
                icon: 'pencil',
                label: 'Update these details',
                onPress: () => setEditing(true),
                testID: 'header-update',
              }
        }
      />

      <ScrollView contentContainerStyle={styles.body}>
        {loading && !entry ? (
          <Loader label="Loading..." />
        ) : error || !entry ? (
          <Card>
            <FieldError message={error ?? 'This attendance entry could not be found'} />
            <Pressable
              onPress={() => router.replace('/attendance/list')}
              style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
              accessibilityRole="button"
              accessibilityLabel="Back to the attendance list"
            >
              <Text style={styles.linkText}>Back to Attendance List</Text>
            </Pressable>
          </Card>
        ) : (
          <>
            <Card
              title="Attendance details"
              subtitle={editing ? 'Change what you need, then Save' : 'Tap the pencil above to edit'}
            >
              <Field label="Saathi Name" required>
                {editing ? (
                  <Dropdown
                    title="Saathi Name"
                    value={empIdText}
                    options={empOptions}
                    onChange={setEmpIdText}
                    placeholder="Choose a Saathi"
                    invalid={!empIdText}
                  />
                ) : (
                  <ReadOnly value={saathiName} icon="account" />
                )}
              </Field>

              <Field label="Date" required>
                {editing ? (
                  <DateField
                    title="Date"
                    value={dateUi}
                    onChange={setDateUi}
                    maxDate={toUi(today())}
                    invalid={!dateDb}
                  />
                ) : (
                  <ReadOnly value={dateUi || '-'} icon="calendar-month" />
                )}
              </Field>

              <Field label="Status" required>
                {editing ? (
                  <Dropdown
                    title="Status"
                    value={status}
                    options={statusOptions(entry.status)}
                    onChange={setStatus}
                  />
                ) : (
                  <View style={styles.statusBox}>
                    <View style={[styles.pill, { backgroundColor: meta.tint }]}>
                      <MaterialCommunityIcons
                        name={meta.icon as never}
                        size={16}
                        color={meta.color}
                      />
                      <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                )}
              </Field>

              {/* Belongs to the Saathi, not to this day - read-only in both modes. */}
              <Field
                label="Saathi Status"
                hint="Set on the Saathi's own page, not here"
              >
                <ReadOnly
                  value={saathiStatus ? employeeStatusLabel(saathiStatus) : '-'}
                  icon={saathiStatus === 'active' ? 'account-check' : 'account-off'}
                  locked
                />
              </Field>

              {saveError ? <FieldError message={saveError} /> : null}

              {/* Save is the default action: filled, raised and listed first. */}
              <View style={styles.actions}>
                <Pressable
                  onPress={() => void onSave()}
                  disabled={!editing || saving}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnPrimary,
                    pressed && styles.btnPrimaryPressed,
                    (!editing || saving) && styles.btnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save these changes"
                  accessibilityState={{ disabled: !editing || saving }}
                  testID="detail-save"
                >
                  <MaterialCommunityIcons name="content-save" size={20} color={colors.onColor} />
                  <Text style={styles.btnPrimaryText}>{saving ? 'Saving...' : 'Save'}</Text>
                </Pressable>

                <Pressable
                  onPress={onCancel}
                  disabled={!editing || saving}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnGhost,
                    pressed && styles.btnGhostPressed,
                    (!editing || saving) && styles.btnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel and keep the saved details"
                  accessibilityState={{ disabled: !editing || saving }}
                  testID="detail-cancel"
                >
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </Pressable>
              </View>

              {!editing ? (
                <Text style={styles.modeHint}>
                  These buttons work once you tap the pencil beside the title.
                </Text>
              ) : null}
            </Card>

            <Text style={styles.enteredBy}>
              {'Last updated ' + prettyDate(entry.updated_at.slice(0, 10))}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** A field that looks like an input but cannot be typed in. */
function ReadOnly({ value, icon, locked }: { value: string; icon: string; locked?: boolean }) {
  return (
    <View style={[styles.readOnly, locked && styles.readOnlyLocked]}>
      <MaterialCommunityIcons
        name={icon as never}
        size={22}
        color={locked ? colors.textDisabled : colors.primary}
      />
      <Text style={styles.readOnlyText}>{value}</Text>
      {locked ? (
        <MaterialCommunityIcons name="lock" size={16} color={colors.textDisabled} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  body: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  readOnlyLocked: { backgroundColor: tints.neutral, borderStyle: 'dashed' },
  readOnlyText: { ...typography.body, flex: 1 },

  statusBox: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  pillText: { ...typography.captionStrong, fontSize: 14 },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  btn: {
    flex: 1,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primaryDark,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  btnPrimaryPressed: { backgroundColor: colors.primaryDark },
  btnPrimaryText: { ...typography.button, color: colors.onColor },
  btnGhost: { backgroundColor: colors.surface, borderColor: colors.border },
  btnGhostPressed: { backgroundColor: colors.background },
  btnGhostText: { ...typography.button, color: colors.textSecondary },
  btnDisabled: { opacity: 0.45 },

  modeHint: { ...typography.caption, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },

  enteredBy: { ...typography.caption, fontSize: 12, textAlign: 'center' },

  link: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  linkPressed: { opacity: 0.6 },
  linkText: {
    ...typography.captionStrong,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
