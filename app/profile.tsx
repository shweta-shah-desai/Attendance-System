import React, { useEffect, useState } from 'react';
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
import { Redirect, router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Card, Field, FieldError, IndiaFlag, Loader, ScreenHeader } from '../src/components';
import { colors, tints } from '../src/constants/colors';
import { radius, spacing, MIN_TOUCH } from '../src/constants/spacing';
import { typography } from '../src/constants/typography';
import { useAuth } from '../src/hooks/useAuth';
import type { User } from '../src/types/user';
import { initials, phoneUi } from '../src/utils/formatters';
import {
  profileSchema,
  sanitizeEmail,
  sanitizeName,
  type ProfileForm,
} from '../src/utils/validators';

/** The stored account row, in the shape the form works in. */
const toForm = (u: User): ProfileForm => ({
  name: u.name,
  phone: u.phone,
  email: u.email_id ?? '',
  address: u.resi_address ?? '',
});

const EMPTY_FORM: ProfileForm = { name: '', phone: '', email: '', address: '' };

/**
 * "My Profile" - the signed-in account, shown as a form.
 *
 * Same shape as Saathi Details: it opens read-only and the pencil beside the
 * title turns the fields into inputs, validated by one schema, so a value that
 * could not be typed on the way in cannot be edited in either.
 *
 * Two fields are deliberately not editable:
 *
 * - **Mobile number.** It is the sign-in credential and Supabase auth owns it,
 *   so changing it here would leave the user signing in with a number their
 *   profile no longer shows. Changing it for real needs an SMS confirmation.
 * - **Join date.** Stored (users.join_date) but never rendered, by request.
 *
 * Saving writes to local SQLite and queues the row; the sync engine pushes the
 * name, email and address up to `profiles` on its next cycle.
 */
export default function ProfileScreen() {
  const { status: authStatus, user, updateProfile } = useAuth();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: EMPTY_FORM,
    mode: 'onTouched',
  });

  // The row arrives after the first render, and again after every save.
  useEffect(() => {
    if (user) reset(toForm(user));
  }, [user, reset]);

  if (authStatus === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  const startEdit = () => {
    if (user) reset(toForm(user));
    setSaveError(null);
    setSaved(false);
    setEditing(true);
  };

  const onCancel = () => {
    if (user) reset(toForm(user));
    setSaveError(null);
    setEditing(false);
  };

  const onValid = async (values: ProfileForm) => {
    setSaveError(null);
    setSaving(true);
    try {
      await updateProfile({
        name: values.name.trim(),
        email_id: values.email?.trim() || null,
        resi_address: values.address?.trim() || null,
      });
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setSaveError(
        e instanceof Error && e.message
          ? 'Could not save: ' + e.message
          : 'Could not save your profile. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="My Profile"
        subtitle={editing ? 'Update mode' : 'View only'}
        action={
          editing || !user
            ? undefined
            : {
                icon: 'pencil',
                label: 'Update my details',
                onPress: startEdit,
                testID: 'profile-update',
              }
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!user ? (
            <Loader label="Loading your profile..." />
          ) : (
            <>
              <Card>
                <View style={styles.identity}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(user.name)}</Text>
                  </View>
                  <View style={styles.identityText}>
                    <Text style={styles.name}>{user.name}</Text>
                    <Text style={styles.phone}>{phoneUi(user.phone)}</Text>
                  </View>
                </View>
              </Card>

              {saved ? (
                <View style={styles.savedBanner}>
                  <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
                  <Text style={styles.savedText}>Your profile has been updated.</Text>
                </View>
              ) : null}

              <Card
                title="Account details"
                subtitle={editing ? 'Fields marked * are must' : 'Tap the pencil above to edit'}
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
                          placeholder="e.g. Shweta S."
                          placeholderTextColor={colors.textDisabled}
                          autoCapitalize="words"
                          maxLength={50}
                          style={[styles.input, errors.name && styles.inputError]}
                          accessibilityLabel="Name"
                        />
                      )}
                    />
                  ) : (
                    <ReadOnly value={user.name} icon="account" />
                  )}
                </Field>

                {/* Never editable - see the note on this component. */}
                <Field
                  label="Mobile number"
                  hint="You sign in with this number, so it cannot be changed here"
                  error={errors.phone?.message}
                >
                  <View style={styles.phoneRow}>
                    <View style={styles.prefix}>
                      <IndiaFlag width={22} />
                      <Text style={styles.prefixText}>+91</Text>
                    </View>
                    <Text style={styles.phoneLocked}>{user.phone}</Text>
                    <MaterialCommunityIcons
                      name="lock-outline"
                      size={18}
                      color={colors.textSecondary}
                      style={styles.lockIcon}
                    />
                  </View>
                </Field>

                <Field
                  label="Email"
                  hint={editing ? 'Optional' : undefined}
                  error={errors.email?.message}
                >
                  {editing ? (
                    <Controller
                      control={control}
                      name="email"
                      render={({ field: { value, onChange, onBlur } }) => (
                        <TextInput
                          value={value ?? ''}
                          onChangeText={(t) => onChange(sanitizeEmail(t))}
                          onBlur={onBlur}
                          placeholder="e.g. name@example.com"
                          placeholderTextColor={colors.textDisabled}
                          autoCapitalize="none"
                          keyboardType="email-address"
                          maxLength={120}
                          style={[styles.input, errors.email && styles.inputError]}
                          accessibilityLabel="Email"
                        />
                      )}
                    />
                  ) : (
                    <ReadOnly value={user.email_id || 'Not added'} icon="email-outline" />
                  )}
                </Field>

                <Field
                  label="Address"
                  hint={editing ? 'Optional' : undefined}
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
                          placeholder="House / street / area"
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
                    <ReadOnly value={user.resi_address || 'Not added'} icon="home-outline" tall />
                  )}
                </Field>

                {saveError ? <FieldError message={saveError} /> : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={handleSubmit(onValid)}
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
                    testID="profile-save"
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
                    testID="profile-cancel"
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

              <Pressable
                onPress={() => router.push('/(auth)/forgot-pin')}
                style={({ pressed }) => [styles.pinRow, pressed && styles.pinRowPressed]}
                accessibilityRole="button"
                accessibilityLabel="Change my PIN"
              >
                <MaterialCommunityIcons name="lock-reset" size={22} color={colors.primary} />
                <View style={styles.pinText}>
                  <Text style={styles.pinTitle}>Change PIN</Text>
                  <Text style={styles.pinSubtitle}>
                    We text a code to your number, then you set a new PIN
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={22}
                  color={colors.textSecondary}
                />
              </Pressable>
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

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h2, color: colors.primary },
  identityText: { flex: 1, gap: spacing.xs },
  name: typography.h2,
  phone: { ...typography.caption },

  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: tints.success,
  },
  savedText: { ...typography.caption, color: colors.success, flex: 1 },

  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
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
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputMultiline: { minHeight: 76, textAlignVertical: 'top', paddingTop: spacing.md },
  inputError: { borderColor: colors.error },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  prefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'stretch',
    backgroundColor: colors.primaryTint,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  prefixText: { ...typography.bodyStrong, color: colors.primaryDark },
  phoneLocked: {
    ...typography.body,
    flex: 1,
    paddingHorizontal: spacing.md,
    letterSpacing: 1,
  },
  lockIcon: { marginRight: spacing.md },

  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryPressed: { backgroundColor: colors.primaryDark },
  btnPrimaryText: { ...typography.button, color: colors.onColor },
  btnGhost: { backgroundColor: colors.surface, borderColor: colors.border },
  btnGhostPressed: { backgroundColor: colors.background },
  btnGhostText: { ...typography.button, color: colors.textSecondary },
  btnDisabled: { opacity: 0.45 },

  modeHint: { ...typography.caption, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },

  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pinRowPressed: { backgroundColor: colors.primaryTint },
  pinText: { flex: 1 },
  pinTitle: { ...typography.bodyStrong },
  pinSubtitle: { ...typography.caption, marginTop: 2 },
});
