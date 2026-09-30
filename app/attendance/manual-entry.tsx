import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
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
import { radius, spacing, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { upsertAttendance } from '../../src/db/queries/attendance';
import { useAuth } from '../../src/hooks/useAuth';
import { useExistingEntry } from '../../src/hooks/useAttendance';
import { useMarkableSaathi } from '../../src/hooks/useEmployees';
import type { Employee } from '../../src/types/attendance';
import { fromUi, prettyDate, today, toUi } from '../../src/utils/date';
import { initials, statusMeta, wageLabel } from '../../src/utils/formatters';
import {
  HAJARI_STATUSES,
  hajariSchema,
  sanitizeName,
  type HajariForm,
  type HajariStatus,
} from '../../src/utils/validators';

/** Present / Absent only - the everyday choice the spec asks for. */
const STATUS_OPTIONS: ReadonlyArray<DropdownOption<HajariStatus>> = HAJARI_STATUSES.map((s) => ({
  value: s,
  label: statusMeta[s].label,
  hint: statusMeta[s].hint,
  icon: statusMeta[s].icon,
}));

/** At most this many name suggestions are listed at once. */
const MAX_SUGGESTIONS = 6;

/**
 * "Hajari (Attendance)" - the daily attendance entry form.
 *
 * The date arrives from the Home calendar (falling back to today). The Saathi is
 * chosen by typing a name and picking from the suggestions, which is what fills
 * emp_id - so the id written to the table is always a real Saathi of this user.
 * Saving writes one attendance row as entry_type 'manual', entered_by = the
 * signed-in user.
 */
export default function HajariScreen() {
  const { status: authStatus, user } = useAuth();
  const params = useLocalSearchParams<{ date?: string }>();

  // The Home calendar passes a YYYY-MM-DD date; the form works in dd/mm/yyyy.
  const initialDate = useMemo(() => toUi(params.date) || toUi(today()), [params.date]);
  const defaults = useMemo<HajariForm>(
    () => ({ date: initialDate, name: '', emp_id: '', status: 'Present', remarks: '' }),
    [initialDate],
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<HajariForm>({
    resolver: zodResolver(hajariSchema),
    defaultValues: defaults,
    mode: 'onTouched',
  });

  const dateUi = watch('date');
  const typedName = watch('name');
  const empIdText = watch('emp_id');
  const remarks = watch('remarks') ?? '';

  const dateDb = fromUi(dateUi);
  const empId = empIdText ? Number(empIdText) : null;

  const {
    employees,
    loading: listLoading,
    error: listError,
    reload,
  } = useMarkableSaathi(dateDb ?? '');
  const { entry: existing } = useExistingEntry(empId, dateDb);

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

  // Arriving from the Home calendar with a different date must move the form
  // onto that date, even if this screen is already mounted.
  useEffect(() => {
    setValue('date', initialDate, { shouldValidate: false });
  }, [initialDate, setValue]);

  const selected = employees.find((e) => e.id === empId) ?? null;

  /** Suggestions for what is typed; the whole list when the box is empty. */
  const suggestions = useMemo(() => {
    const q = typedName.trim().toLowerCase();
    const pool = q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [employees, typedName]);

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
    // The typed text no longer stands for a chosen Saathi, unless it is an
    // exact name match - then keep the convenience of not having to tap.
    const exact = employees.find((e) => e.name.toLowerCase() === clean.trim().toLowerCase());
    setValue('emp_id', exact ? String(exact.id) : '', { shouldValidate: false });
    setSuggestOpen(true);
  };

  const flashSaved = (message: string) => {
    setSaved(message);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setSaved(null), 5000);
  };

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  /** Cancel: back to the date we arrived with and an empty form. */
  const clearForm = () => {
    reset(defaults);
    setShowSummary(false);
    setSaveError(null);
    setSuggestOpen(false);
  };

  const onValid = async (values: HajariForm) => {
    const db = fromUi(values.date);
    if (!db) {
      setSaveError('That date could not be read. Please pick it from the calendar.');
      return;
    }

    setShowSummary(false);
    setSaveError(null);
    setSaving(true);
    const wasUpdate = existing != null;
    try {
      await upsertAttendance({
        emp_id: Number(values.emp_id),
        date: db,
        time_in: null,
        time_out: null,
        status: values.status,
        remarks: values.remarks?.trim() || null,
        entry_type: 'manual',
        entered_by: user?.id ?? null,
      });

      // Keep the date so several Saathi can be marked for the same day in a row.
      reset({ ...defaults, date: values.date });
      setSuggestOpen(false);
      flashSaved(
        values.name.trim() +
          (wasUpdate ? ' updated to ' : ' marked ') +
          values.status +
          ' on ' +
          values.date,
      );
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? 'Could not save: ' + e.message
          : 'Could not save this entry. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const summary = (
    [
      ['date', 'Date', errors.date?.message],
      ['name', 'Name', errors.name?.message],
      ['emp_id', 'Name', errors.emp_id?.message],
      ['status', 'Att.', errors.status?.message],
      ['remarks', 'Remarks', errors.remarks?.message],
    ] as const
  )
    .filter(([, , message]) => !!message)
    .map(([, label, message]) => label + ': ' + message);

  // A failed load leaves employees empty too, so it must not be reported as
  // "no Saathi on this date" - that sends the user off to add a duplicate.
  const noSaathi = !listLoading && !listError && employees.length === 0;

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Hajari (Attendance)"
        subtitle={dateDb ? prettyDate(dateDb) : 'Pick a date'}
      />

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
                <Text style={styles.noSaathiTitle}>No Saathi to mark on this date</Text>
                <Text style={styles.noSaathiBody}>
                  Only Working Saathi inside their Kaam period can be marked. Add one, or
                  pick another date.
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

          <Card title="Hajari details" subtitle="Fields marked * are must">
            <Field label="Date" required error={errors.date?.message}>
              <Controller
                control={control}
                name="date"
                render={({ field: { value, onChange } }) => (
                  <DateField
                    title="Date"
                    value={value}
                    onChange={(next) => {
                      onChange(next);
                      // A different date can have a different set of Saathi.
                      setValue('emp_id', '', { shouldValidate: false });
                    }}
                    maxDate={toUi(today())}
                    invalid={!!errors.date}
                  />
                )}
              />
            </Field>

            <Field
              label="Name"
              required
              error={errors.name?.message ?? errors.emp_id?.message}
              hint={
                selected
                  ? undefined
                  : 'Start typing - the list below suggests your Saathi'
              }
            >
              <Controller
                control={control}
                name="name"
                render={({ field: { value, onBlur } }) => (
                  <View style={[styles.nameBox, (errors.name || errors.emp_id) && styles.inputError]}>
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
                          ? 'No Saathi can be marked on this date.'
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

            {existing ? (
              <View style={styles.noticeBox}>
                <MaterialCommunityIcons name="information" size={18} color={colors.info} />
                <Text style={styles.noticeText}>
                  {'Already marked ' +
                    existing.status +
                    ' on this date. Saving will update that entry.'}
                </Text>
              </View>
            ) : null}

            <Field label="Att." required error={errors.status?.message}>
              <Controller
                control={control}
                name="status"
                render={({ field: { value, onChange } }) => (
                  <Dropdown
                    title="Att."
                    value={value}
                    options={STATUS_OPTIONS}
                    onChange={onChange}
                    invalid={!!errors.status}
                  />
                )}
              />
            </Field>

            <Field
              label="Remarks"
              counter={remarks.length + '/200'}
              error={errors.remarks?.message}
            >
              <Controller
                control={control}
                name="remarks"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="Came late, half work, informed leave..."
                    placeholderTextColor={colors.textDisabled}
                    multiline
                    maxLength={200}
                    style={[styles.input, styles.inputMultiline, errors.remarks && styles.inputError]}
                    accessibilityLabel="Remarks"
                  />
                )}
              />
            </Field>

            {saveError ? <FieldError message={saveError} /> : null}

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
                accessibilityLabel="Save this attendance entry"
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
                accessibilityLabel="Cancel and clear the form"
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
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

  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
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
});
