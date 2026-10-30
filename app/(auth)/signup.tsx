import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AuthButton,
  AuthLink,
  AuthPopup,
  CodeField,
  FieldError,
  PhoneField,
  authStyles,
} from '../../src/components';
import { colors } from '../../src/constants/colors';
import { useAuth } from '../../src/hooks/useAuth';
import { sanitizeName, signupSchema, type SignupForm } from '../../src/utils/validators';

const EMPTY: SignupForm = { name: '', phone: '', pin: '', confirmPin: '' };

/**
 * Creating a register: name, mobile, and a 6-digit PIN typed twice.
 *
 * The PIN is confirmed because it is the only credential - a mistyped one
 * locks the register until an SMS reset, so catching it here is cheaper than
 * catching it later. The name goes into the signup metadata, where the
 * server-side handle_new_user trigger reads it to build the profile row.
 */
export default function SignupScreen() {
  const { signUp } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: EMPTY,
    mode: 'onTouched',
  });

  const onSubmit = async (values: SignupForm) => {
    setSubmitting(true);
    setFormError(null);
    try {
      const { needsOtp } = await signUp(values.name, values.phone, values.pin);
      if (needsOtp) {
        // The Supabase project confirms phone numbers, so the account exists
        // but has no session yet - the code screen finishes the job.
        router.replace({
          pathname: '/(auth)/verify',
          params: { phone: values.phone, purpose: 'signup' },
        });
        return;
      }
      router.replace('/(tabs)/home');
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : 'Could not create your register. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPopup
      open
      onCancel={() => router.back()}
      cancelLabel="Cancel signup"
      title="Create your register"
      subtitle="Your Hajari is saved to the cloud, so it survives a lost phone."
    >
      <Text style={authStyles.label}>Your name</Text>
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
            returnKeyType="next"
            style={[authStyles.input, !!errors.name && authStyles.inputError]}
            accessibilityLabel="Your name"
          />
        )}
      />
      <FieldError message={errors.name?.message} />

      <Controller
        control={control}
        name="phone"
        render={({ field: { value, onChange, onBlur } }) => (
          <PhoneField
            label="Mobile number"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.phone?.message}
            returnKeyType="next"
          />
        )}
      />

      <Controller
        control={control}
        name="pin"
        render={({ field: { value, onChange, onBlur } }) => (
          <CodeField
            label="Choose a 6 digit PIN"
            placeholder="6 digit PIN"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.pin?.message}
            returnKeyType="next"
          />
        )}
      />

      <Controller
        control={control}
        name="confirmPin"
        render={({ field: { value, onChange, onBlur } }) => (
          <CodeField
            label="Confirm PIN"
            placeholder="Type it again"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.confirmPin?.message}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      <FieldError message={formError ?? undefined} />

      <Text style={authStyles.note}>
        We will text a 6-digit code to this number to confirm it is yours.
      </Text>

      <AuthButton label="Create register" busy={submitting} onPress={handleSubmit(onSubmit)} />

      <AuthLink
        lead="Already have a register?"
        action="Sign in"
        onPress={() => router.back()}
        disabled={submitting}
      />
    </AuthPopup>
  );
}
