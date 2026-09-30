import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

interface Props {
  label?: string;
  /** Use on dark/hero backgrounds. */
  onDark?: boolean;
}

export function Loader({ label, onDark = false }: Props) {
  const tone = onDark ? colors.onColor : colors.primary;
  return (
    <View style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator size="large" color={tone} />
      {label ? <Text style={[styles.label, { color: tone }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  label: { ...typography.caption, marginTop: spacing.md, fontSize: 14 },
});
