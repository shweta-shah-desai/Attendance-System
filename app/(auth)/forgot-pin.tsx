import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AuthButton,
  AuthLink,
  AuthPopup,
  FieldError,
  PhoneField,
  authStyles,
} from '../../src/components';
import { useAuth } from '../../src/hooks/useAuth';
import { phoneOnlySchema, type PhoneOnlyForm } from '../../src/utils/validators';

/**
 * Forgotten PIN, step one: confirm which number to text.
 *
 * The conversion plan expected this to be a dead end with an apology, because
 * it assumed no SMS provider. The project does have one, so the PIN is
 * genuinely recoverable: an SMS code proves the number is yours, and the next
 * two screens take a new PIN. `shouldCreateUser` is off in the store, so an
 * unknown number is reported as such instead of quietly creating a register.
 */
export default function ForgotPinScreen() {
  const { requestOtp } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PhoneOnlyForm>({
    resolver: zodResolver(phoneOnlySchema),
    defaultValues: { phone: '' },
    mode: 'onTouched',
  });

  const onSubmit = async (values: PhoneOnlyForm) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await requestOtp(values.phone, 'reset');
      router.replace({
        pathname: '/(auth)/verify',
        params: { phone: values.phone, purpose: 'reset' },
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not send the code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPopup
      open
      onCancel={() => router.back()}
      cancelLabel="Cancel PIN reset"
      title="Forgot your PIN?"
      subtitle="We will text a code to your registered mobile number so you can set a new PIN."
    >
      <Controller
        control={control}
        name="phone"
        render={({ field: { value, onChange, onBlur } }) => (
          <PhoneField
            label="Registered mobile number"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={errors.phone?.message}
            returnKeyType="done"
            onSubmitEditing={handleSubmit(onSubmit)}
          />
        )}
      />

      <FieldError message={formError ?? undefined} />

      <Text style={authStyles.note}>
        Your Hajari records are not touched by a PIN reset - only the PIN changes.
      </Text>

      <AuthButton label="Send code" busy={submitting} onPress={handleSubmit(onSubmit)} />

      <AuthLink action="Back to sign in" onPress={() => router.back()} disabled={submitting} />
    </AuthPopup>
  );
}
