import React from 'react';
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
  type TextInputProps,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FieldError } from './Field';
import { IndiaFlag } from './IndiaFlag';
import { colors } from '../constants/colors';
import { radius, spacing, shadow, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import { sanitizePhone, sanitizePin } from '../utils/validators';

/** White wordmark - these screens sit on the brand band. See scripts/build-logos.mjs. */
const LOGO = require('../../assets/images/logo-on-dark.png');

interface AuthPopupProps {
  title: string;
  subtitle?: string;
  /** Accessibility label for the X, e.g. "Cancel login". */
  cancelLabel: string;
  onCancel: () => void;
  open: boolean;
  /**
   * Button drawn on the brand backdrop once the popup is closed. Omit on
   * screens whose cancel pops the route, since there is nothing to reopen.
   */
  reopen?: { label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; onPress: () => void };
  children: React.ReactNode;
}

/**
 * The shared shell of every auth screen: the brand backdrop with the wordmark,
 * and the form in a real popup over it so the X genuinely cancels.
 *
 * Login, signup, the SMS code step and the PIN reset all wear this, which is
 * why it lives here rather than being copied into four route files.
 */
export function AuthPopup({
  title,
  subtitle,
  cancelLabel,
  onCancel,
  open,
  reopen,
  children,
}: AuthPopupProps) {
  return (
    <View style={authStyles.root}>
      <View style={authStyles.backdrop}>
        <Image source={LOGO} style={authStyles.logo} resizeMode="contain" />
        <Text style={authStyles.tagline}>Your everyday attendance register</Text>

        {!open && reopen ? (
          <Pressable
            onPress={reopen.onPress}
            style={({ pressed }) => [authStyles.reopenBtn, pressed && authStyles.reopenBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={reopen.label}
          >
            <MaterialCommunityIcons name={reopen.icon} size={20} color={colors.primary} />
            <Text style={authStyles.reopenText}>{reopen.label}</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onCancel}
      >
        <View style={authStyles.scrim}>
          <KeyboardAvoidingView
            style={authStyles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={authStyles.flex}
              contentContainerStyle={authStyles.scrimContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={authStyles.popup}>
                <Pressable
                  onPress={onCancel}
                  hitSlop={12}
                  style={({ pressed }) => [
                    authStyles.closeBtn,
                    pressed && authStyles.closeBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={cancelLabel}
                >
                  <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
                </Pressable>

                <Text style={authStyles.title}>{title}</Text>
                {subtitle ? <Text style={authStyles.subtitle}>{subtitle}</Text> : null}

                {children}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

type NumericFieldProps = {
  value: string;
  onChangeText: (next: string) => void;
  onBlur?: () => void;
  error?: string;
  label: string;
} & Pick<TextInputProps, 'placeholder' | 'returnKeyType' | 'onSubmitEditing' | 'autoFocus'>;

/** The +91 prefix row - the number is stored as 10 digits, prefix and all. */
export function PhoneField({ value, onChangeText, onBlur, error, label, ...rest }: NumericFieldProps) {
  return (
    <>
      <Text style={authStyles.label}>{label}</Text>
      <View style={[authStyles.phoneRow, !!error && authStyles.inputError]}>
        <View style={authStyles.prefix}>
          <IndiaFlag width={22} />
          <Text style={authStyles.prefixText}>+91</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={(t) => onChangeText(sanitizePhone(t))}
          onBlur={onBlur}
          placeholder="10 digit number"
          placeholderTextColor={colors.textDisabled}
          keyboardType="number-pad"
          maxLength={10}
          style={authStyles.phoneInput}
          accessibilityLabel={label}
          {...rest}
        />
      </View>
      <FieldError message={error} />
    </>
  );
}

/**
 * Six-digit numeric input used for the PIN and for the SMS code. `secure` is
 * on for PINs and off for the code, which the user needs to read back.
 */
export function CodeField({
  value,
  onChangeText,
  onBlur,
  error,
  label,
  secure = true,
  ...rest
}: NumericFieldProps & { secure?: boolean }) {
  return (
    <>
      <Text style={authStyles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => onChangeText(sanitizePin(t))}
        onBlur={onBlur}
        placeholderTextColor={colors.textDisabled}
        keyboardType="number-pad"
        secureTextEntry={secure}
        maxLength={6}
        style={[authStyles.input, !secure && authStyles.codeInput, !!error && authStyles.inputError]}
        accessibilityLabel={label}
        {...rest}
      />
      <FieldError message={error} />
    </>
  );
}

/** The full-width primary action at the bottom of every auth popup. */
export function AuthButton({
  label,
  busyLabel = 'Please wait...',
  busy,
  onPress,
}: {
  label: string;
  busyLabel?: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        authStyles.primaryBtn,
        pressed && authStyles.primaryBtnPressed,
        busy && authStyles.primaryBtnDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
    >
      <Text style={authStyles.primaryText}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

/** Centred text link under the primary action ("New here? ...", "Forgot PIN?"). */
export function AuthLink({
  lead,
  action,
  onPress,
  disabled,
}: {
  lead?: string;
  action: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={authStyles.linkRow}
      accessibilityRole="link"
      accessibilityLabel={`${lead ?? ''} ${action}`.trim()}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={authStyles.helper}>
        {lead ? `${lead} ` : ''}
        <Text style={[authStyles.linkText, disabled && authStyles.linkDisabled]}>{action}</Text>
      </Text>
    </Pressable>
  );
}

export const authStyles = StyleSheet.create({
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
  /** The SMS code is read off a notification, so it gets room to breathe. */
  codeInput: { textAlign: 'center', fontSize: 22, letterSpacing: 8 },
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

  primaryBtn: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  primaryBtnPressed: { backgroundColor: colors.primaryDark },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryText: { ...typography.button, color: colors.onColor, letterSpacing: 0.3 },

  linkRow: { alignSelf: 'center', paddingVertical: spacing.sm },
  helper: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
  linkText: { ...typography.captionStrong, color: colors.primary },
  linkDisabled: { color: colors.textDisabled },

  /** Standalone note, e.g. what happens to an unsynced register on reset. */
  note: {
    ...typography.caption,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    color: colors.primaryDark,
  },
});
