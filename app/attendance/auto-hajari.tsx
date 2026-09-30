import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { autoMarkRange } from '../../src/db/queries/attendance';
import { useAuth } from '../../src/hooks/useAuth';
import { useEmployees } from '../../src/hooks/useEmployees';
import type { Employee } from '../../src/types/attendance';
import {
  currentMonth,
  daysBetween,
  fromUi,
  lastNDays,
  monthEnd,
  monthStart,
  prettyDate,
  previousMonth,
  today,
  toUi,
} from '../../src/utils/date';
import { initials, statusMeta, wageLabel } from '../../src/utils/formatters';
import {
  autoHajariSchema,
  HAJARI_STATUSES,
  sanitizeName,
  type AutoHajariForm,
  type AutoPeriod,
  type HajariStatus,
} from '../../src/utils/validators';

/** The "For period" combo, in the order the spec lists it. */
const PERIOD_OPTIONS: ReadonlyArray<DropdownOption<AutoPeriod>> = [
  {
    value: 'current_month',
    label: 'Current Month',
    hint: 'From the 1st of this month up to today',
    icon: 'calendar-month',
  },
  {
    value: 'last_month',
    label: 'Last Month',
    hint: 'The whole of the month before this one',
    icon: 'calendar-arrow-left',
  },
  {
    value: 'last_15',
    label: 'Last 15 Days',
    hint: 'Today and the fourteen days before it',
    icon: 'calendar-range',
  },
  {
    value: 'last_7',
    label: 'Last 7 Days',
    hint: 'Today and the six days before it',
    icon: 'calendar-week',
  },
  {
    value: 'custom',
    label: 'Custom Date',
    hint: 'Pick your own From and To dates',
    icon: 'calendar-edit',
  },
];

/** Present / Absent only - the same everyday choice as the Hajari form. */
const STATUS_OPTIONS: ReadonlyArray<DropdownOption<HajariStatus>> = HAJARI_STATUSES.map((s) => ({
  value: s,
  label: statusMeta[s].label,
  hint: statusMeta[s].hint,
  icon: statusMeta[s].icon,
}));

const MAX_SUGGESTIONS = 6;
const DEFAULT_PERIOD: AutoPeriod = 'current_month';

interface Span {
  from: string;
  to: string;
}

/**
 * The window each fixed period stands for, in YYYY-MM-DD. Custom Date has no
 * window of its own - the user's own From/To are used as typed.
 *
 * Current Month stops at today rather than at the end of the month, because
 * attendance cannot be marked for a future date.
 */
const periodSpan = (period: AutoPeriod): Span | null => {
  switch (period) {
    case 'current_month':
      return { from: monthStart(currentMonth()), to: today() };
    case 'last_month': {
      const month = previousMonth();
      return { from: monthStart(month), to: monthEnd(month) };
    }
    case 'last_15':
      return lastNDays(15);
    case 'last_7':
      return lastNDays(7);
    default:
      return null;
  }
};

/**
 * "Auto Hajari (Attendance)" - stamps one status across a whole period for one
 * Saathi, instead of marking day after day on the Hajari form.
 *
 * The Saathi is chosen by typing a name and picking a suggestion, which is what
 * fills emp_id, so the id written to the table is always a real Saathi of this
 * user. "For period" drives the From/To boxes: every value but Custom Date
 * fills them in and locks them. The window is then trimmed to the Saathi's Kaam
 * From / Kaam Till period, so a bulk run cannot mark days they were not
 * working. Saving asks for confirmation first, because one tap can write as
 * many rows as the period is long. Days that already carry an entry are never
 * touched: a bulk run must not quietly replace what was marked by hand.
 */
export default function AutoHajariScreen() {
  const { status: authStatus, user } = useAuth();

  const defaults = useMemo<AutoHajariForm>(() => {
    const span = periodSpan(DEFAULT_PERIOD) ?? lastNDays(1);
    return {
      name: '',
      emp_id: '',
      period: DEFAULT_PERIOD,
      from: toUi(span.from),
      to: toUi(span.to),
      status: 'Present',
    };
  }, []);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  /** The values waiting on a yes/no in the confirmation dialog. */
  const [pending, setPending] = useState<AutoHajariForm | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AutoHajariForm>({
    resolver: zodResolver(autoHajariSchema),
    defaultValues: defaults,
    mode: 'onTouched',
  });

  const period = watch('period');
  const typedName = watch('name');
  const empIdText = watch('emp_id');
  const fromText = watch('from');
  const toText = watch('to');
  const status = watch('status');

  const custom = period === 'custom';
  const empId = empIdText ? Number(empIdText) : null;

  // Only a Saathi still on the books can be given a period of attendance.
  const {
    employees,
    loading: listLoading,
    error: listError,
    reload,
  } = useEmployees({ status: 'active' });

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    },
    [],
  );

  // A fixed period owns its From/To boxes; Custom Date hands them back to the
  // user, keeping whatever the last period put there as a starting point.
  useEffect(() => {
    const span = periodSpan(period);
    if (!span) return;
    setValue('from', toUi(span.from), { shouldValidate: false });
    setValue('to', toUi(span.to), { shouldValidate: false });
  }, [period, setValue]);

  const selected = employees.find((e) => e.id === empId) ?? null;

  const suggestions = useMemo(() => {
    const q = typedName.trim().toLowerCase();
    const pool = q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [employees, typedName]);

  const askedFrom = fromUi(fromText);
  const askedTo = fromUi(toText);

  /**
   * The days that will actually be written: the asked-for window narrowed to
   * the chosen Saathi's Kaam period. Null means there is nothing to write -
   * either the window is not filled in yet, or none of it falls inside their
   * period.
   */
  const effective = useMemo<Span | null>(() => {
    if (!askedFrom || !askedTo || askedTo < askedFrom) return null;
    const start = selected?.start_date || null;
    const end = selected?.end_date || null;
    const from = start && start > askedFrom ? start : askedFrom;
    const to = end && end < askedTo ? end : askedTo;
    return to < from ? null : { from, to };
  }, [askedFrom, askedTo, selected]);

  const trimmed =
    !!effective &&
    !!askedFrom &&
    !!askedTo &&
    (effective.from !== askedFrom || effective.to !== askedTo);
  const dayCount = effective ? daysBetween(effective.from, effective.to) : 0;

  const pickSaathi = (employee: Employee) => {
    setValue('name', employee.name, { shouldValidate: true });
    setValue('emp_id', String(employee.id), { shouldValidate: true });
    setSuggestOpen(false);
    setSaveError(null);
    Keyboard.dismiss();
  };

  const onNameChange = (text: string) => {
    const clean = sanitizeName(text);
    setValue('name', clean, { shouldValidate: false });
    // Typed text only stands for a chosen Saathi when it matches a name exactly.
    const exact = employees.find((e) => e.name.toLowerCase() === clean.trim().toLowerCase());
    setValue('emp_id', exact ? String(exact.id) : '', { shouldValidate: false });
    setSuggestOpen(true);
  };

  const flashSaved = (message: string) => {
    setSaved(message);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setSaved(null), 6000);
  };

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  /** Clear: an empty form back on the default Current Month period. */
  const clearForm = () => {
    reset(defaults);
    setShowSummary(false);
    setSaveError(null);
    setSaved(null);
    setSuggestOpen(false);
    setPending(null);
  };

  /** Save asks first - a valid form only opens the confirmation. */
  const onValid = (values: AutoHajariForm) => {
    setShowSummary(false);
    setSaveError(null);
    if (!effective) {
      setSaveError(
        selected
          ? 'No day of this period falls inside ' + selected.name + "'s Kaam period."
          : 'That period could not be read. Please pick the From and To dates again.',
      );
      return;
    }
    Keyboard.dismiss();
    setSuggestOpen(false);
    setPending(values);
  };

  const confirmSave = async () => {
    if (!pending || !effective) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await autoMarkRange({
        emp_id: Number(pending.emp_id),
        from: effective.from,
        to: effective.to,
        status: pending.status,
        entered_by: user?.id ?? null,
      });
      setPending(null);
      const name = pending.name.trim();
      const left =
        result.skipped > 0
          ? ' ' +
            result.skipped +
            (result.skipped === 1 ? ' day was' : ' days were') +
            ' already marked and left unchanged.'
          : '';
      flashSaved(
        result.added === 0
          ? 'Every day of this period was already marked for ' + name + '. Nothing changed.'
          : name +
              ' marked ' +
              pending.status +
              ' on ' +
              result.added +
              (result.added === 1 ? ' new day.' : ' new days.') +
              left,
      );
      // The period and status stay put so the next Saathi can be given the same
      // run; only the name is cleared.
      setValue('name', '', { shouldValidate: false });
      setValue('emp_id', '', { shouldValidate: false });
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? 'Could not save: ' + e.message
          : 'Could not save this attendance. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const summary = (
    [
      ['name', 'Name', errors.name?.message],
      ['emp_id', 'Name', errors.emp_id?.message],
      ['period', 'For period', errors.period?.message],
      ['from', 'From', errors.from?.message],
      ['to', 'To', errors.to?.message],
      ['status', 'Status', errors.status?.message],
    ] as const
  )
    .filter(([, , message]) => !!message)
    .map(([, label, message]) => label + ': ' + message);

  // A failed load leaves employees empty too, so it must not be reported as
  // "no Saathi yet" - that sends the user off to add a duplicate.
  const noSaathi = !listLoading && !listError && employees.length === 0;

  const subtitle = effective
    ? prettyDate(effective.from) + '  to  ' + prettyDate(effective.to)
    : 'Pick a period';

  return (
    <View style={styles.root}>
      <ScreenHeader title="Auto Hajari (Attendance)" subtitle={subtitle} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {saved ? (
            <View style={styles.successBanner}>
              <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
              <Text style={styles.successText}>{saved}</Text>
              <Pressable
                onPress={() => setSaved(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Hide message"
              >
                <MaterialCommunityIcons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}

          {showSummary && summary.length > 0 ? (
            <View style={styles.errorBanner}>
              <View style={styles.errorBannerHead}>
                <MaterialCommunityIcons name="alert-circle" size={22} color={colors.error} />
                <Text style={styles.errorBannerTitle}>
                  {summary.length === 1
                    ? 'Please correct 1 field'
                    : 'Please correct ' + summary.length + ' fields'}
                </Text>
              </View>
              {summary.map((line) => (
                <Text key={line} style={styles.errorBannerLine}>
                  {'•  ' + line}
                </Text>
              ))}
            </View>
          ) : null}

          {listError ? (
            <View style={styles.listError}>
              <FieldError message={listError} />
              <Pressable
                onPress={() => void reload()}
                style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                accessibilityRole="button"
                accessibilityLabel="Try loading the Saathi list again"
              >
                <Text style={styles.linkText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {noSaathi ? (
            <View style={styles.noSaathi}>
              <MaterialCommunityIcons name="account-alert" size={22} color={colors.warning} />
              <View style={styles.noSaathiText}>
                <Text style={styles.noSaathiTitle}>No Working Saathi yet</Text>
                <Text style={styles.noSaathiBody}>
                  Auto Hajari needs a Working Saathi to mark. Add one first.
                </Text>
                <Pressable
                  onPress={() => router.push('/admin/new-saathi')}
                  style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                  accessibilityRole="link"
                  accessibilityLabel="Go to New Saathi"
                >
                  <Text style={styles.linkText}>Add a new Saathi</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <Card title="Auto Hajari details" subtitle="Fields marked * are must">
            <Field
              label="Name"
              required
              error={errors.name?.message ?? errors.emp_id?.message}
              hint={selected ? undefined : 'Start typing - the list below suggests your Saathi'}
            >
              <Controller
                control={control}
                name="name"
                render={({ field: { value, onBlur } }) => (
                  <View
                    style={[styles.nameBox, (errors.name || errors.emp_id) && styles.inputError]}
                  >
                    <MaterialCommunityIcons
                      name="account-search"
                      size={22}
                      color={colors.primary}
                    />
                    <TextInput
                      value={value}
                      onChangeText={onNameChange}
                      onBlur={onBlur}
                      onFocus={() => setSuggestOpen(true)}
                      placeholder="Type the Saathi name"
                      placeholderTextColor={colors.textDisabled}
                      autoCapitalize="words"
                      autoCorrect={false}
                      maxLength={50}
                      style={styles.nameInput}
                      accessibilityLabel="Saathi name"
                    />
                    {value ? (
                      <Pressable
                        onPress={() => {
                          setValue('name', '', { shouldValidate: false });
                          setValue('emp_id', '', { shouldValidate: false });
                          setSuggestOpen(true);
                        }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Clear the name"
                      >
                        <MaterialCommunityIcons
                          name="close-circle"
                          size={20}
                          color={colors.textDisabled}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                )}
              />

              {selected ? (
                <View style={styles.chosen}>
                  <MaterialCommunityIcons name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.chosenText}>
                    {wageLabel(selected.wage_amt, selected.wage_type)}
                  </Text>
                </View>
              ) : null}

              {suggestOpen && !selected ? (
                <View style={styles.suggestBox}>
                  {listLoading ? (
                    <Loader label="Loading Saathi..." />
                  ) : suggestions.length === 0 ? (
                    <Text style={styles.suggestEmpty}>
                      {listError
                        ? 'Could not load your Saathi list.'
                        : employees.length === 0
                          ? 'No Working Saathi to mark.'
                          : 'No Saathi name matches that.'}
                    </Text>
                  ) : (
                    suggestions.map((emp, i) => (
                      <Pressable
                        key={emp.id}
                        onPress={() => pickSaathi(emp)}
                        style={({ pressed }) => [
                          styles.suggestRow,
                          i === suggestions.length - 1 && styles.suggestRowLast,
                          pressed && styles.suggestRowPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={'Choose ' + emp.name}
                      >
                        <View style={styles.suggestAvatar}>
                          <Text style={styles.suggestAvatarText}>{initials(emp.name)}</Text>
                        </View>
                        <View style={styles.suggestText}>
                          <Text style={styles.suggestName}>{emp.name}</Text>
                          <Text style={styles.suggestMeta}>
                            {wageLabel(emp.wage_amt, emp.wage_type)}
                          </Text>
                        </View>
                        <MaterialCommunityIcons
                          name="chevron-right"
                          size={22}
                          color={colors.textDisabled}
                        />
                      </Pressable>
                    ))
                  )}
                </View>
              ) : null}
            </Field>

            <Field
              label="For period"
              required
              error={errors.period?.message}
              hint={custom ? undefined : 'From and To are set by the period you choose'}
            >
              <Controller
                control={control}
                name="period"
                render={({ field: { value, onChange } }) => (
                  <Dropdown
                    title="For period"
                    value={value}
                    options={PERIOD_OPTIONS}
                    onChange={onChange}
                    invalid={!!errors.period}
                  />
                )}
              />
            </Field>

            {/* From and To read as one window, so they sit side by side. */}
            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <Field label="From" required error={errors.from?.message}>
                  <Controller
                    control={control}
                    name="from"
                    render={({ field: { value, onChange } }) => (
                      <DateField
                        title="From"
                        value={value}
                        onChange={onChange}
                        disabled={!custom}
                        maxDate={toUi(today())}
                        invalid={!!errors.from}
                      />
                    )}
                  />
                </Field>
              </View>

              <View style={styles.dateCol}>
                <Field label="To" required error={errors.to?.message}>
                  <Controller
                    control={control}
                    name="to"
                    render={({ field: { value, onChange } }) => (
                      <DateField
                        title="To"
                        value={value}
                        onChange={onChange}
                        disabled={!custom}
                        minDate={fromText}
                        maxDate={toUi(today())}
                        invalid={!!errors.to}
                      />
                    )}
                  />
                </Field>
              </View>
            </View>

            {trimmed && effective && selected ? (
              <View style={styles.noticeBox}>
                <MaterialCommunityIcons name="information" size={18} color={colors.info} />
                <Text style={styles.noticeText}>
                  {'Trimmed to ' +
                    selected.name +
                    "'s Kaam period: " +
                    toUi(effective.from) +
                    ' to ' +
                    toUi(effective.to) +
                    '.'}
                </Text>
              </View>
            ) : null}

            <Field label="Status" required error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field: { value, onChange } }) => (
                  <Dropdown
                    title="Status"
                    value={value}
                    options={STATUS_OPTIONS}
                    onChange={onChange}
                    invalid={!!errors.status}
                  />
                )}
              />
            </Field>

            {effective ? (
              <View style={styles.countBox}>
                <MaterialCommunityIcons name="calendar-check" size={18} color={colors.primary} />
                <Text style={styles.countText}>
                  {'Up to ' +
                    dayCount +
                    (dayCount === 1 ? ' day' : ' days') +
                    ' will be marked ' +
                    status +
                    ' - days already marked are left as they are'}
                </Text>
              </View>
            ) : null}

            {saveError && !pending ? <FieldError message={saveError} /> : null}

            {/* Save is the default action: filled, raised and listed first. */}
            <View style={styles.actions}>
              <Pressable
                onPress={handleSubmit(onValid, () => setShowSummary(true))}
                disabled={saving}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnPrimary,
                  pressed && styles.btnPrimaryPressed,
                  saving && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Save this auto attendance"
                accessibilityState={{ disabled: saving }}
              >
                <MaterialCommunityIcons name="content-save" size={20} color={colors.onColor} />
                <Text style={styles.btnPrimaryText}>{saving ? 'Saving...' : 'Save'}</Text>
              </Pressable>

              <Pressable
                onPress={clearForm}
                disabled={saving}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnGhost,
                  pressed && styles.btnGhostPressed,
                  saving && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Clear the form"
              >
                <Text style={styles.btnGhostText}>Clear</Text>
              </Pressable>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmSave
        form={pending}
        span={effective}
        days={dayCount}
        busy={saving}
        error={saveError}
        onConfirm={() => void confirmSave()}
        onCancel={() => setPending(null)}
      />
    </View>
  );
}

interface ConfirmProps {
  form: AutoHajariForm | null;
  span: Span | null;
  days: number;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Save confirmation.
 *
 * It spells out the Saathi, the status, the window and how many days it covers,
 * and says that days already marked are left alone - because one tap here can
 * write as many rows as the period is long.
 */
function ConfirmSave({ form, span, days, busy, error, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal
      transparent
      visible={!!form && !!span}
      animationType="fade"
      onRequestClose={busy ? () => {} : onCancel}
    >
      <View style={styles.scrim}>
        <View style={styles.dialog}>
          <View style={styles.dialogIcon}>
            <MaterialCommunityIcons name="calendar-check" size={28} color={colors.primary} />
          </View>

          <Text style={styles.dialogTitle}>Save this auto Hajari?</Text>
          <Text style={styles.dialogBody}>
            {form && span
              ? form.name.trim() +
                ' will be marked ' +
                form.status +
                ' on all ' +
                days +
                (days === 1 ? ' day' : ' days') +
                ' from ' +
                toUi(span.from) +
                ' to ' +
                toUi(span.to) +
                ' that is not marked yet. Days that already have an entry are left as they are.'
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
              accessibilityLabel="Do not save yet"
            >
              <Text style={styles.dialogBtnGhostText}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.dialogBtn,
                styles.dialogBtnPrimary,
                pressed && styles.dialogBtnPressed,
                busy && styles.dialogBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save this auto attendance"
              testID="confirm-auto-hajari"
            >
              <Text style={styles.dialogBtnPrimaryText}>{busy ? 'Saving...' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  body: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: tints.success,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  successText: { ...typography.captionStrong, color: colors.success, flex: 1, fontSize: 14 },

  errorBanner: {
    backgroundColor: tints.error,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  errorBannerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorBannerTitle: { ...typography.bodyStrong, color: colors.error, fontSize: 15, flex: 1 },
  errorBannerLine: { ...typography.caption, color: colors.error, marginLeft: spacing.xl },

  listError: {
    backgroundColor: tints.error,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },

  noSaathi: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: tints.warning,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noSaathiText: { flex: 1 },
  noSaathiTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.warning },
  noSaathiBody: { ...typography.caption, marginTop: 2 },
  link: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  linkPressed: { opacity: 0.6 },
  linkText: {
    ...typography.captionStrong,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },

  inputError: { borderColor: colors.error },

  nameBox: {
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
  nameInput: { flex: 1, height: '100%', fontSize: 16, color: colors.textPrimary },

  chosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  chosenText: { ...typography.captionStrong, fontSize: 13, color: colors.success },

  suggestBox: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  suggestEmpty: { ...typography.caption, padding: spacing.md },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  suggestRowLast: { borderBottomWidth: 0 },
  suggestRowPressed: { backgroundColor: colors.primaryTint },
  suggestAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestAvatarText: { ...typography.captionStrong, color: colors.primary, fontSize: 13 },
  suggestText: { flex: 1 },
  suggestName: { ...typography.bodyStrong, fontSize: 15 },
  suggestMeta: { ...typography.caption, fontSize: 12 },

  dateRow: { flexDirection: 'row', gap: spacing.md },
  dateCol: { flex: 1 },

  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: tints.info,
  },
  noticeText: { ...typography.caption, color: colors.info, flex: 1, fontSize: 13 },

  countBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
  },
  countText: { ...typography.captionStrong, color: colors.primary, flex: 1, fontSize: 13 },

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
  btnDisabled: { opacity: 0.6 },

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
    backgroundColor: colors.primaryTint,
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
  dialogBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  dialogBtnPrimaryText: { ...typography.button, fontSize: 15, color: colors.onColor },
});
