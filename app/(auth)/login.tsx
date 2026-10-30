import React, { useState } from 'react';
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
} from '../../src/components';
import { useAuth } from '../../src/hooks/useAuth';
import { loginSchema, type LoginForm } from '../../src/utils/validators';

const EMPTY: LoginForm = { phone: '', pin: '' };

/**
 * Sign-in: 10-digit Indian mobile + the 6-digit account PIN.
 *
 * This screen no longer creates accounts. The old rule - an unknown number
 * silently becomes a new register - is unsafe against a cloud database, where
 * a mistyped digit would hand someone an empty register instead of telling
 * them they typed it wrong. Creating a register is now an explicit signup.
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
      await signIn(values.phone, values.pin);
      router.replace('/(tabs)/home');
    } catch (e) {
      // authStore already separates a wrong PIN from an outage; one generic
      // line here would make a dropped connection look like a typo.
      setFormError(e instanceof Error ? e.message : 'Could not sign you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPopup
      open={popupOpen}
      onCancel={cancel}
      cancelLabel="Cancel login"
      title="Welcome"
      subtitle="Enter your mobile number and PIN to open your attendance register."
      reopen={{ label: 'LogIn', icon: 'login', onPress: () => setPopupOpen(true) }}
    >
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
            label="PIN"
            placeholder="6 digit PIN"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.pin?.message}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      <FieldError message={formError ?? undefined} />

      <AuthButton label="LogIn" busy={submitting} onPress={handleSubmit(onSubmit)} />

      <AuthLink
        lead="New here?"
        action="Create your register"
        onPress={() => router.push('/(auth)/signup')}
        disabled={submitting}
      />
      <AuthLink
        action="Forgot PIN?"
        onPress={() => router.push('/(auth)/forgot-pin')}
        disabled={submitting}
      />
    </AuthPopup>
  );
}
