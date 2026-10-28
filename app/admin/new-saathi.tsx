import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
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
  IndiaFlag,
  Loader,
  SaathiRow,
  ScreenHeader,
  type DropdownOption,
} from '../../src/components';
import { colors, tints } from '../../src/constants/colors';
import { radius, spacing, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { createEmployee, findEmployeeByPhone } from '../../src/db/queries/employees';
import { useAuth } from '../../src/hooks/useAuth';
import { useWorkingSaathi } from '../../src/hooks/useEmployees';
import { fromUi } from '../../src/utils/date';
import { wageTypeHelp } from '../../src/utils/formatters';
import {
  employeeSchema,
  sanitizeAmount,
  sanitizeName,
  sanitizePhone,
  type EmployeeForm,
} from '../../src/utils/validators';

/** Field defaults - also what Cancel resets the form back to. */
const DEFAULTS: EmployeeForm = {
  name: '',
  phone: '',
  address: '',
  wage_type: 'Monthly',
  wage_amt: '',
  remarks: '',
  start_date: '',
  end_date: '',
  status: 'active',
};

/** Spec wording: Monthly / Rokadi (Daily) / Bi-weekly, default Monthly. */
const WAGE_TYPE_OPTIONS: ReadonlyArray<DropdownOption<EmployeeForm['wage_type']>> = [
  { value: 'Monthly', label: 'Monthly', hint: wageTypeHelp.Monthly },
  { value: 'Rokadi', label: 'Rokadi (Daily)', hint: wageTypeHelp.Rokadi },
  { value: 'Bi-weekly', label: 'Bi-weekly', hint: wageTypeHelp['Bi-weekly'] },
];

/** employees.status is active/inactive in the table, Working/Not Working here. */
const STATUS_OPTIONS: ReadonlyArray<DropdownOption<EmployeeForm['status']>> = [
  { value: 'active', label: 'Working', hint: 'Comes to work - appears in attendance lists' },
  { value: 'inactive', label: 'Not Working', hint: 'Left or on a long break - hidden from marking' },
];

/** The order errors are listed in the summary - same order as the form. */
const FIELD_ORDER: Array<{ key: keyof EmployeeForm; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'wage_type', label: 'Wages Type' },
  { key: 'wage_amt', label: 'Wages Amount' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'start_date', label: 'Kaam From' },
  { key: 'end_date', label: 'Kaam Till' },
  { key: 'status', label: 'Status' },
];

/**
 * "New Saathi" - the employee entry screen.
 *
 * The form writes one employees row (owner_id = signed-in user, created_at
 * stamped by SQLite) and the Working Saathi list below it re-reads the table
 * straight after, so the user sees the Saathi they just added.
 */
/**
 * How long the cursor waits before it is put back in the Name box after a save.
 * Long enough for the reset, the banner and the reloaded Working Saathi list
 * to have rendered, so the focus lands on a box that is staying put.
 */
const FOCUS_DELAY_MS = 120;

export default function NewSaathiScreen() {
  const { status: authStatus, user } = useAuth();
  const { employees, loading, error: listError, reload } = useWorkingSaathi();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ name: string; working: boolean } | null>(null);
  // Set when Add is pressed with invalid fields; drives the summary banner.
  const [showSummary, setShowSummary] = useState(false);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<TextInput>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: DEFAULTS,
    mode: 'onTouched',
  });

  // Kaam From / Kaam Till bound each other's calendar, so an impossible range
  // cannot be picked in the first place.
  const kaamFrom = watch('start_date') ?? '';
  const kaamTill = watch('end_date') ?? '';
  const address = watch('address') ?? '';
  const remarks = watch('remarks') ?? '';

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(
    () => () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const flashAdded = (name: string, working: boolean) => {
    setAdded({ name, working });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setAdded(null), 5000);
  };

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const clearForm = () => {
    reset(DEFAULTS);
    setShowSummary(false);
    setSaveError(null);
  };

  const onValid = async (values: EmployeeForm) => {
    setShowSummary(false);
    setSaveError(null);
    setSaving(true);
    try {
      const phone = values.phone?.trim() ?? '';
      if (phone) {
        const clash = await findEmployeeByPhone(phone, user?.id ?? null);
        if (clash) {
          setError('phone', {
            message: clash.name + ' is already saved with this number',
          });
          setShowSummary(true);
          return;
        }
      }

      // owner_id is NOT NULL since v2 - a Saathi with no household cannot be
      // scoped by Row Level Security, so there is nothing sensible to write.
      if (!user) {
        setSaveError('Please sign in again before adding a Saathi.');
        setShowSummary(true);
        return;
      }

      await createEmployee({
        name: values.name.trim(),
        phone,
        resi_address: values.address?.trim() || null,
        status: values.status,
        remarks: values.remarks?.trim() || null,
        start_date: fromUi(values.start_date),
        end_date: fromUi(values.end_date),
        wage_type: values.wage_type,
        wage_amt: Number(values.wage_amt),
        owner_id: user.id,
      });

      clearForm();
      flashAdded(values.name.trim(), values.status === 'active');
      // Emptying the form makes the page shorter; going back to the top keeps
      // the Name box on screen for the cursor that is about to land in it.
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      await reload();

      // The form is empty again, so the cursor belongs where the next Saathi
      // starts - one less tap before typing the following name.
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => nameRef.current?.focus(), FOCUS_DELAY_MS);
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? 'Could not save: ' + e.message
          : 'Could not save this Saathi. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const summary = FIELD_ORDER.map(({ key, label }) => {
    const message = errors[key]?.message;
    return message ? label + ': ' + message : null;
  }).filter(Boolean) as string[];

  return (
    <View style={styles.root}>
      <ScreenHeader title="New Saathi" subtitle="Add a helper to your register" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* No keyboardDismissMode here on purpose: it blurs whatever is focused
            whenever a scroll settles, and emptying the form after a save moves
            the page enough to count as one - which would take the cursor
            straight back out of the Name box. */}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {added ? (
            <View style={styles.successBanner}>
              <MaterialCommunityIcons name="check-circle" size={22} color={colors.success} />
              <Text style={styles.successText}>
                {added.working
                  ? added.name + ' added to your Working Saathi list.'
                  : added.name + ' saved as Not Working - find them under All Saathi.'}
              </Text>
              <Pressable
                onPress={() => setAdded(null)}
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

          <Card title="Saathi details" subtitle="Fields marked * are must">
            <Field label="Name" required error={errors.name?.message}>
              <Controller
                control={control}
                name="name"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    ref={nameRef}
                    value={value}
                    onChangeText={(t) => onChange(sanitizeName(t))}
                    onBlur={onBlur}
                    placeholder="e.g. Ramesh Kumar"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="words"
                    maxLength={50}
                    style={[styles.input, errors.name && styles.inputError]}
                    accessibilityLabel="Name"
                  />
                )}
              />
            </Field>

            <Field label="Phone" hint="Optional - Indian mobile number" error={errors.phone?.message}>
              <Controller
                control={control}
                name="phone"
                render={({ field: { value, onChange, onBlur } }) => (
                  <View style={[styles.phoneRow, errors.phone && styles.inputError]}>
                    <View style={styles.prefix}>
                      <IndiaFlag width={22} />
                      <Text style={styles.prefixText}>+91</Text>
                    </View>
                    <TextInput
                      value={value ?? ''}
                      onChangeText={(t) => onChange(sanitizePhone(t))}
                      onBlur={onBlur}
                      placeholder="10 digit number"
                      placeholderTextColor={colors.textDisabled}
                      keyboardType="number-pad"
                      maxLength={10}
                      style={styles.phoneInput}
                      accessibilityLabel="Phone"
                    />
                  </View>
                )}
              />
            </Field>

            <Field
              label="Address"
              counter={address.length + '/120'}
              error={errors.address?.message}
            >
              <Controller
                control={control}
                name="address"
                render={({ field: { value, onChange, onBlur } }) => (
                  <TextInput
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    placeholder="House / area where the Saathi stays"
                    placeholderTextColor={colors.textDisabled}
                    multiline
                    maxLength={120}
                    style={[styles.input, styles.inputMultiline, errors.address && styles.inputError]}
                    accessibilityLabel="Address"
                  />
                )}
              />
            </Field>

            <Field label="Wages Type" required error={errors.wage_type?.message}>
              <Controller
                control={control}
                name="wage_type"
                render={({ field: { value, onChange } }) => (
                  <Dropdown
                    title="Wages Type"
                    value={value}
                    options={WAGE_TYPE_OPTIONS}
                    onChange={onChange}
                    invalid={!!errors.wage_type}
                  />
                )}
              />
            </Field>

            <Field
              label="Wages Amount"
              required
              hint={'In rupees, no paise - ' + wageTypeHelp[watch('wage_type')].toLowerCase()}
              error={errors.wage_amt?.message}
            >
              <Controller
                control={control}
                name="wage_amt"
                render={({ field: { value, onChange, onBlur } }) => (
                  <View style={[styles.amountRow, errors.wage_amt && styles.inputError]}>
                    <Text style={styles.rupee}>{'₹'}</Text>
                    <TextInput
                      value={value}
                      onChangeText={(t) => onChange(sanitizeAmount(t))}
                      onBlur={onBlur}
                      placeholder="0"
                      placeholderTextColor={colors.textDisabled}
                      keyboardType="number-pad"
                      maxLength={7}
                      style={styles.amountInput}
                      accessibilityLabel="Wages Amount"
                    />
                  </View>
                )}
              />
            </Field>

            <Field
              label="Remarks"
              counter={remarks.length + '/150'}
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
                    placeholder="Anything to remember - work done, timings, etc."
                    placeholderTextColor={colors.textDisabled}
                    multiline
                    maxLength={150}
                    style={[styles.input, styles.inputMultiline, errors.remarks && styles.inputError]}
                    accessibilityLabel="Remarks"
                  />
                )}
              />
            </Field>

            <View style={styles.dateRow}>
              <View style={styles.dateCol}>
                <Field label="Kaam From" error={errors.start_date?.message}>
                  <Controller
                    control={control}
                    name="start_date"
                    render={({ field: { value, onChange } }) => (
                      <DateField
                        title="Kaam From"
                        value={value ?? ''}
                        onChange={onChange}
                        maxDate={kaamTill || undefined}
                        invalid={!!errors.start_date}
                      />
                    )}
                  />
                </Field>
              </View>
              <View style={styles.dateCol}>
                <Field label="Kaam Till" error={errors.end_date?.message}>
                  <Controller
                    control={control}
                    name="end_date"
                    render={({ field: { value, onChange } }) => (
                      <DateField
                        title="Kaam Till"
                        value={value ?? ''}
                        onChange={onChange}
                        minDate={kaamFrom || undefined}
                        invalid={!!errors.end_date}
                      />
                    )}
                  />
                </Field>
              </View>
            </View>

            <Field label="Status" error={errors.status?.message}>
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

            {saveError ? <FieldError message={saveError} /> : null}

            {/* Add is the default action, so it carries the filled style and
                sits first; Cancel only resets the form. */}
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
                accessibilityLabel="Add this Saathi"
                accessibilityState={{ disabled: saving }}
              >
                <MaterialCommunityIcons
                  name="account-plus"
                  size={20}
                  color={colors.onColor}
                />
                <Text style={styles.btnPrimaryText}>{saving ? 'Saving...' : 'Add'}</Text>
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

          <Card padded={false} style={styles.listCard}>
            <View style={styles.listHead}>
              <View style={styles.listHeadText}>
                <Text style={styles.listTitle}>Working Saathi</Text>
                <Text style={styles.listCount}>
                  {employees.length === 1 ? '1 Saathi' : employees.length + ' Saathi'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/admin/employees')}
                hitSlop={8}
                style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                accessibilityRole="link"
                accessibilityLabel="Go to All Saathi"
              >
                <Text style={styles.linkText}>All Saathi</Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
              </Pressable>
            </View>

            <View style={styles.listBody}>
              {loading && employees.length === 0 ? (
                <Loader label="Loading your Saathi..." />
              ) : listError ? (
                <FieldError message={listError} />
              ) : employees.length === 0 ? (
                <View style={styles.empty}>
                  <MaterialCommunityIcons
                    name="account-group-outline"
                    size={40}
                    color={colors.textDisabled}
                  />
                  <Text style={styles.emptyText}>
                    No Working Saathi yet. Fill the form above to add your first one.
                  </Text>
                </View>
              ) : (
                employees.map((emp, i) => (
                  <SaathiRow
                    key={emp.id}
                    employee={emp}
                    last={i === employees.length - 1}
                  />
                ))
              )}
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
  inputMultiline: { minHeight: 76, textAlignVertical: 'top' },
  inputError: { borderColor: colors.error },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    height: '100%',
    backgroundColor: colors.primaryTint,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  prefixText: { ...typography.bodyStrong, color: colors.primaryDark },
  phoneInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    fontSize: 16,
    letterSpacing: 1,
    color: colors.textPrimary,
  },

  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  rupee: {
    ...typography.h3,
    color: colors.primaryDark,
    height: '100%',
    textAlignVertical: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryTint,
    lineHeight: MIN_TOUCH,
  },
  amountInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  dateRow: { flexDirection: 'row', gap: spacing.md },
  dateCol: { flex: 1 },

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
    // Raised so it reads as the default action of the form.
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

  listCard: { overflow: 'hidden' },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  listHeadText: { flex: 1 },
  listTitle: typography.h3,
  listCount: { ...typography.caption, fontSize: 12, marginTop: 1 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
  },
  linkPressed: { opacity: 0.6 },
  linkText: {
    ...typography.captionStrong,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },

  listBody: { paddingHorizontal: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { ...typography.caption, textAlign: 'center', maxWidth: 260 },
});
