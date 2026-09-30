import React, { useState } from 'react';
import {
  Image,
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
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { IndiaFlag } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { radius, spacing, shadow, MIN_TOUCH } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { useAuth } from '../../src/hooks/useAuth';
import { loginSchema, sanitizeName, sanitizePhone, type LoginForm } from '../../src/utils/validators';

/** White wordmark - this screen is on the brand band. See scripts/build-logos.mjs. */
const LOGO = require('../../assets/images/logo-on-dark.png');

const EMPTY: LoginForm = { name: '', phone: '' };

/**
 * Login popup: name + 10-digit Indian mobile.
 *
 * The form lives in a real popup over the brand screen, so the X truly cancels
 * it; the LogIn button on the screen behind brings it back. A known mobile
 * number signs in, an unknown one creates the account - either way the next
 * screen is Home.
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [popupOpen, setPopupOpen] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: EMPTY,
    mode: 'onTouched',
  });

  /** Cancel (X): drop whatever was typed and close the popup. */
  const cancel = () => {
    reset(EMPTY);
    setFormError(null);
    setPopupOpen(false);
  };

  const onSubmit = async (values: LoginForm) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await signIn(values.name.trim(), values.phone);
      router.replace('/(tabs)/home');
    } catch {
      setFormError('Could not sign you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.backdrop}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={styles.tagline}>Your everyday attendance register</Text>

        {!popupOpen ? (
          <Pressable
            onPress={() => setPopupOpen(true)}
            style={({ pressed }) => [styles.reopenBtn, pressed && styles.reopenBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Open the login popup"
          >
            <MaterialCommunityIcons name="login" size={20} color={colors.primary} />
            <Text style={styles.reopenText}>LogIn</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={popupOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={cancel}
      >
        <View style={styles.scrim}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrimContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.popup}>
                <Pressable
                  onPress={cancel}
                  hitSlop={12}
                  style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel login"
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
                </Pressable>

                <Text style={styles.title}>Welcome</Text>
                <Text style={styles.subtitle}>
                  Enter your name and mobile number to open your attendance register.
                </Text>

                <Text style={styles.label}>Your name</Text>
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
                      accessibilityLabel="Your name"
                    />
                  )}
                />
                <FieldError message={errors.name?.message} />

                <Text style={styles.label}>Mobile number</Text>
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
                        value={value}
                        onChangeText={(t) => onChange(sanitizePhone(t))}
                        onBlur={onBlur}
                        placeholder="10 digit number"
                        placeholderTextColor={colors.textDisabled}
                        keyboardType="number-pad"
                        maxLength={10}
                        returnKeyType="done"
                        onSubmitEditing={handleSubmit(onSubmit)}
                        style={styles.phoneInput}
                        accessibilityLabel="Mobile number"
                      />
                    </View>
                  )}
                />
                <FieldError message={errors.phone?.message} />
                {formError ? <FieldError message={formError} /> : null}

                <Pressable
                  onPress={handleSubmit(onSubmit)}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.loginBtn,
                    pressed && styles.loginBtnPressed,
                    submitting && styles.loginBtnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Log in"
                  accessibilityState={{ disabled: submitting }}
                >
                  <Text style={styles.loginText}>{submitting ? 'Please wait...' : 'LogIn'}</Text>
                </Pressable>

                <Text style={styles.helper}>
                  New here? Just enter your details - your register is created automatically.
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.errorRow}>
      <MaterialCommunityIcons name="alert-circle" size={15} color={colors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.primary },
  flex: { flex: 1 },

  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  logo: { width: 200, height: 33 },
  tagline: { ...typography.caption, color: colors.onColor, opacity: 0.9 },
  reopenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    minWidth: 200,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    marginTop: spacing.xl,
    ...shadow.raised,
  },
  reopenBtnPressed: { backgroundColor: colors.primaryTint },
  reopenText: { ...typography.button, color: colors.primary },

  /** Dimmed layer the popup sits on. */
  scrim: { flex: 1, backgroundColor: colors.overlay },
  scrimContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },

  popup: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.raised,
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    zIndex: 1,
  },
  closeBtnPressed: { backgroundColor: colors.border },

  title: { ...typography.h1, paddingRight: spacing.xxl },
  subtitle: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.lg },

  label: { ...typography.captionStrong, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    height: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.error },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MIN_TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
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

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },

  loginBtn: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  loginBtnPressed: { backgroundColor: colors.primaryDark },
  loginBtnDisabled: { opacity: 0.6 },
  loginText: { ...typography.button, color: colors.onColor, letterSpacing: 0.3 },

  helper: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
