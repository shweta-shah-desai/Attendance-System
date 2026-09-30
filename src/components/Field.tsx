import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

interface FieldProps {
  label: string;
  /** Draws the red asterisk the forms use to flag mandatory input. */
  required?: boolean;
  /** Small helper line under the input - e.g. what a wage type means. */
  hint?: string;
  error?: string;
  /** Right-aligned character counter, e.g. "32/120". */
  counter?: string;
  children: React.ReactNode;
}

/**
 * Label + input + error/hint wrapper shared by every form on the app, so
 * mandatory markers, counters and error styling stay identical everywhere.
 */
export function Field({ label, required, hint, error, counter, children }: FieldProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.star}> *</Text> : null}
        </Text>
        {counter ? <Text style={styles.counter}>{counter}</Text> : null}
      </View>

      {children}

      {error ? <FieldError message={error} /> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** One-line inline error with the alert icon, used by forms and popups. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View style={styles.errorRow}>
      <MaterialCommunityIcons name="alert-circle" size={15} color={colors.error} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  label: { ...typography.captionStrong, fontSize: 14, flex: 1 },
  star: { color: colors.error, fontWeight: '700' },
  counter: { ...typography.caption, fontSize: 12, color: colors.textDisabled },
  hint: { ...typography.caption, fontSize: 12, marginTop: spacing.xs },

  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  errorText: { ...typography.caption, color: colors.error, flex: 1 },
});
