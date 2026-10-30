import React, { useState } from 'react';
import { router } from 'expo-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthButton, AuthPopup, CodeField, FieldError } from '../../src/components';
import { useAuth } from '../../src/hooks/useAuth';
import { pinResetSchema, type PinResetForm } from '../../src/utils/validators';

const EMPTY: PinResetForm = { pin: '', confirmPin: '' };

/**
 * Forgotten PIN, step three: set the new one.
 *
 * Reached only from the verify screen, which means the SMS code has already
 * been confirmed and a session exists - that session is what authorises the
 * password change, so there is no code or old PIN to ask for again. Cancel
 * signs out rather than going back, since a half-finished reset must not
 * leave the register open on a session the user did not log in to.
 */
export default function ResetPinScreen() {
  const { updatePin, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<PinResetForm>({
    resolver: zodResolver(pinResetSchema),
    defaultValues: EMPTY,
    mode: 'onTouched',
  });

  const onSubmit = async (values: PinResetForm) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await updatePin(values.pin);
      router.replace('/(tabs)/home');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the new PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  const abandon = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <AuthPopup
      open
      onCancel={abandon}
      cancelLabel="Cancel PIN reset"
      title="Set a new PIN"
      subtitle="Choose a 6-digit PIN you will remember. You will use it to sign in from now on."
    >
      <Controller
        control={control}
        name="pin"
        render={({ field: { value, onChange, onBlur } }) => (
          <CodeField
            label="New PIN"
            placeholder="6 digit PIN"
            autoFocus
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
            label="Confirm new PIN"
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

      <AuthButton label="Save new PIN" busy={submitting} onPress={handleSubmit(onSubmit)} />
    </AuthPopup>
  );
}
