import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AuthButton,
  AuthLink,
  AuthPopup,
  CodeField,
  FieldError,
  authStyles,
} from '../../src/components';
import { useAuth } from '../../src/hooks/useAuth';
import { otpSchema, type OtpForm } from '../../src/utils/validators';

/** Seconds before "Send a new code" becomes tappable - each resend costs an SMS. */
const RESEND_AFTER_S = 45;

/**
 * SMS code step, shared by signup and the forgotten-PIN reset.
 *
 * The Supabase project has "Confirm phone" ON with a real SMS provider, so a
 * signup has no session until the code is confirmed here; the reset flow uses
 * the same code as its proof of ownership. `purpose` decides where success
 * goes: straight to Home for a signup, on to the new-PIN screen for a reset.
 */
export default function VerifyScreen() {
  const { phone = '', purpose = 'signup' } = useLocalSearchParams<{
    phone?: string;
    purpose?: 'signup' | 'reset';
  }>();
  const isReset = purpose === 'reset';
  const { verifyOtp, requestOtp } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_AFTER_S);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // One interval for the life of the screen; the resend restarts the count
  // rather than stacking a second timer on top.
  useEffect(() => {
    timer.current = setInterval(() => {
      setCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<OtpForm>({
    resolver: zodResolver(otpSchema),
    defaultValues: { code: '' },
    mode: 'onTouched',
  });

  const onSubmit = async (values: OtpForm) => {
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      await verifyOtp(phone, values.code);
      // A verified reset is signed in but still holds the old PIN, so it must
      // not land on Home before the new one is set.
      router.replace(isReset ? '/(auth)/reset-pin' : '/(tabs)/home');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not confirm that code.');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    setFormError(null);
    setNotice(null);
    try {
      await requestOtp(phone, isReset ? 'reset' : 'signup');
      setCooldown(RESEND_AFTER_S);
      setNotice('A new code is on its way.');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not send a new code.');
    }
  };

  return (
    <AuthPopup
      open
      onCancel={() => router.back()}
      cancelLabel="Cancel confirmation"
      title="Confirm your number"
      subtitle={`Enter the 6-digit code we texted to +91 ${phone}.`}
    >
      <Controller
        control={control}
        name="code"
        render={({ field: { value, onChange, onBlur } }) => (
          <CodeField
            label="SMS code"
            placeholder="------"
            secure={false}
            autoFocus
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.code?.message}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      <FieldError message={formError ?? undefined} />
      {notice ? <Text style={authStyles.note}>{notice}</Text> : null}

      <AuthButton
        label={isReset ? 'Confirm and reset PIN' : 'Confirm and continue'}
        busy={submitting}
        onPress={handleSubmit(onSubmit)}
      />

      <AuthLink
        action={cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        onPress={resend}
        disabled={cooldown > 0 || submitting}
      />
    </AuthPopup>
  );
}
