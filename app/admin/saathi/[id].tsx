import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  IndiaFlag,
  Loader,
  ScreenHeader,
  type DropdownOption,
} from '../../../src/components';
import { colors, tints } from '../../../src/constants/colors';
import { radius, spacing, MIN_TOUCH } from '../../../src/constants/spacing';
import { typography } from '../../../src/constants/typography';
import { findEmployeeByPhone, updateEmployee } from '../../../src/db/queries/employees';
import { useAuth } from '../../../src/hooks/useAuth';
import { useEmployeeDetail } from '../../../src/hooks/useEmployees';
import type { Employee } from '../../../src/types/attendance';
import { fromUi, toUi } from '../../../src/utils/date';
import {
  employeeStatusLabel,
  initials,
  inr,
  phoneUi,
  wageTypeHelp,
} from '../../../src/utils/formatters';
import {
  employeeSchema,
  sanitizeAmount,
  sanitizeName,
  sanitizePhone,
  type EmployeeForm,
} from '../../../src/utils/validators';

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

/** The stored row, in the shape the form works in. */
const toForm = (e: Employee): EmployeeForm => ({
  name: e.name,
  phone: e.phone ?? '',
  address: e.resi_address ?? '',
  wage_type: e.wage_type,
  wage_amt: String(e.wage_amt),
  remarks: e.remarks ?? '',
  start_date: toUi(e.start_date),
  end_date: toUi(e.end_date),
  status: e.status,
});

const EMPTY_FORM: EmployeeForm = {
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

/**
 * "Saathi Details" - one Saathi, shown as a form.
 *
 * Opened by the eye icon on the All Saathi table. It shows every field the New
 * Saathi form collects and opens read-only; the pencil beside the title turns
 * the same fields into the same inputs, validated by the same schema, so a
 * value that could not be typed on the way in cannot be edited in either.
 */
export default function SaathiDetailScreen() {
  const { status: authStatus, user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? null;

  const { employee, loading, error, reload } = useEmployeeDetail(id);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set when Save is pressed with invalid fields; drives the summary banner.
  const [showSummary, setShowSummary] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<EmployeeForm>({
    resolver: zodResolver(employeeSchema),
    defaultValues: EMPTY_FORM,
    mode: 'onTouched',
  });

  // The row arrives after the first render, and again after every save.
  useEffect(() => {
    if (employee) reset(toForm(employee));
  }, [employee, reset]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const kaamFrom = watch('start_date') ?? '';
  const kaamTill = watch('end_date') ?? '';
  const address = watch('address') ?? '';
  const remarks = watch('remarks') ?? '';
  const wageType = watch('wage_type');

  const summary = useMemo(
    () =>
      FIELD_ORDER.map(({ key, label }) => {
        const message = errors[key]?.message;
        return message ? label + ': ' + message : null;
      }).filter(Boolean) as string[],
    [errors],
  );

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const startEdit = () => {
    if (employee) reset(toForm(employee));
    setSaveError(null);
    setShowSummary(false);
    setEditing(true);
  };

  const onCancel = () => {
    if (employee) reset(toForm(employee));
    setSaveError(null);
    setShowSummary(false);
    setEditing(false);
  };

  const onValid = async (values: EmployeeForm) => {
    if (!employee) return;
    setShowSummary(false);
    setSaveError(null);
    setSaving(true);
    try {
      const phone = values.phone?.trim() ?? '';
      if (phone) {
        const clash = await findEmployeeByPhone(phone, user?.id ?? null);
        // The Saathi's own number is not a clash with themselves.
        if (clash && clash.id !== employee.id) {
          setError('phone', {
            message: clash.name + ' is already saved with this number',
          });
          setShowSummary(true);
          return;
        }
      }

      await updateEmployee(employee.id, {
        name: values.name.trim(),
        phone,
        resi_address: values.address?.trim() || null,
        status: values.status,
        remarks: values.remarks?.trim() || null,
        start_date: fromUi(values.start_date),
        end_date: fromUi(values.end_date),
        wage_type: values.wage_type,
        wage_amt: Number(values.wage_amt),
      });

      setEditing(false);
      // Straight back to All Saathi, which reloads on focus and so already
      // shows the change. Going back rather than replacing keeps the search
      // and sort the user was browsing with.
      if (router.canGoBack()) router.back();
      else router.replace('/admin/employees');
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

  const working = employee?.status === 'active';

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Saathi Details"
        subtitle={editing ? 'Update mode' : 'View only'}
        action={
          editing || !employee
            ? undefined
            : {
                icon: 'pencil',
                label: 'Update these details',
                onPress: startEdit,
                testID: 'header-update',
              }
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {loading && !employee ? (
            <Loader label="Loading..." />
          ) : error || !employee ? (
            <Card>
              <FieldError message={error ?? 'This Saathi could not be found'} />
              <Pressable
                onPress={() => router.replace('/admin/employees')}
                style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                accessibilityRole="button"
                accessibilityLabel="Back to All Saathi"
              >
                <Text style={styles.linkText}>Back to All Saathi</Text>
              </Pressable>
            </Card>
          ) : (
            <>
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

              {/* Who this is, so the form below never has to be read to know. */}
              <Card>
                <View style={styles.identity}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(employee.name)}</Text>
                  </View>
                  <View style={styles.identityText}>
                    <Text style={styles.name}>{employee.name}</Text>
                    <View style={[styles.chip, working ? styles.chipWorking : styles.chipNot]}>
                      <Text
                        style={[
                          styles.chipText,
                          { color: working ? colors.success : colors.textSecondary },
                        ]}
                      >
                        {employeeStatusLabel(employee.status)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Card>

              <Card
                title="Saathi details"
                subtitle={
                  editing ? 'Fields marked * are must' : 'Tap the pencil above to edit'
                }
              >
                <Field label="Name" required error={errors.name?.message}>
                  {editing ? (
                    <Controller
                      control={control}
                      name="name"
                      render={({ field: { value, onChange, onBlur } }) => (
                        <TextInput
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
                  ) : (
                    <ReadOnly value={employee.name} icon="account" />
                  )}
                </Field>

                <Field
                  label="Phone"
                  hint={editing ? 'Optional - Indian mobile number' : undefined}
                  error={errors.phone?.message}
                >
                  {editing ? (
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
                  ) : (
                    <ReadOnly value={phoneUi(employee.phone)} icon="phone" />
                  )}
                </Field>

                <Field
                  label="Address"
                  counter={editing ? address.length + '/120' : undefined}
                  error={errors.address?.message}
                >
                  {editing ? (
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
                          style={[
                            styles.input,
                            styles.inputMultiline,
                            errors.address && styles.inputError,
                          ]}
                          accessibilityLabel="Address"
                        />
                      )}
                    />
                  ) : (
                    <ReadOnly value={employee.resi_address || '-'} icon="map-marker" tall />
                  )}
                </Field>

                <Field label="Wages Type" required error={errors.wage_type?.message}>
                  {editing ? (
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
                  ) : (
                    <ReadOnly
                      value={
                        WAGE_TYPE_OPTIONS.find((o) => o.value === employee.wage_type)?.label ??
                        employee.wage_type
                      }
                      icon="cash-clock"
                    />
                  )}
                </Field>

                <Field
                  label="Wages Amount"
                  required
                  hint={
                    editing
                      ? 'In rupees, no paise - ' + wageTypeHelp[wageType].toLowerCase()
                      : undefined
                  }
                  error={errors.wage_amt?.message}
                >
                  {editing ? (
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
                  ) : (
                    <ReadOnly value={inr(employee.wage_amt)} icon="currency-inr" />
                  )}
                </Field>

                <Field
                  label="Remarks"
                  counter={editing ? remarks.length + '/150' : undefined}
                  error={errors.remarks?.message}
                >
                  {editing ? (
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
                          style={[
                            styles.input,
                            styles.inputMultiline,
                            errors.remarks && styles.inputError,
                          ]}
                          accessibilityLabel="Remarks"
                        />
                      )}
                    />
                  ) : (
                    <ReadOnly value={employee.remarks || '-'} icon="note-text" tall />
                  )}
                </Field>

                <View style={styles.dateRow}>
                  <View style={styles.dateCol}>
                    <Field label="Kaam From" error={errors.start_date?.message}>
                      {editing ? (
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
                      ) : (
                        <ReadOnly
                          value={toUi(employee.start_date) || '-'}
                          icon="calendar-start"
                        />
                      )}
                    </Field>
                  </View>
                  <View style={styles.dateCol}>
                    <Field label="Kaam Till" error={errors.end_date?.message}>
                      {editing ? (
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
                      ) : (
                        <ReadOnly value={toUi(employee.end_date) || '-'} icon="calendar-end" />
                      )}
                    </Field>
                  </View>
                </View>

                <Field label="Status" error={errors.status?.message}>
                  {editing ? (
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
                  ) : (
                    <ReadOnly
                      value={employeeStatusLabel(employee.status)}
                      icon={working ? 'account-check' : 'account-off'}
                    />
                  )}
                </Field>

                {saveError ? <FieldError message={saveError} /> : null}

                {/* Save is the default action: filled, raised and listed first. */}
                <View style={styles.actions}>
                  <Pressable
                    onPress={handleSubmit(onValid, () => setShowSummary(true))}
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
                    <MaterialCommunityIcons
                      name="content-save"
                      size={20}
                      color={colors.onColor}
                    />
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
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** A field that looks like an input but cannot be typed in. */
function ReadOnly({ value, icon, tall }: { value: string; icon: string; tall?: boolean }) {
  return (
    <View style={[styles.readOnly, tall && styles.readOnlyTall]}>
      <MaterialCommunityIcons name={icon as never} size={22} color={colors.primary} />
      <Text style={styles.readOnlyText}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  body: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  errorBanner: {
    backgroundColor: tints.error,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xxs,
  },
  errorBannerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  errorBannerTitle: { ...typography.bodyStrong, color: colors.error, fontSize: 15, flex: 1 },
  errorBannerLine: { ...typography.caption, color: colors.error, marginLeft: spacing.xl },

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h2, color: colors.primary },
  identityText: { flex: 1, gap: spacing.xs },
  name: typography.h2,
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  chipWorking: { backgroundColor: tints.success },
  chipNot: { backgroundColor: tints.neutral },
  chipText: { fontSize: 12, fontWeight: '700' },

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
  readOnlyTall: { minHeight: 76, alignItems: 'flex-start', paddingVertical: spacing.md },
  readOnlyText: { ...typography.body, flex: 1 },

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
    paddingHorizontal: spacing.md,
    height: '100%',
    lineHeight: MIN_TOUCH,
    color: colors.primaryDark,
    backgroundColor: colors.primaryTint,
  },
  amountInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: spacing.md,
    fontSize: 18,
    fontWeight: '700',
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

  link: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  linkPressed: { opacity: 0.6 },
  linkText: {
    ...typography.captionStrong,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
