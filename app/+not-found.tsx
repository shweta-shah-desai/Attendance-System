import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../src/constants/colors';
import { radius, spacing } from '../src/constants/spacing';
import { typography } from '../src/constants/typography';

/**
 * Fallback for menu entries whose screens have not been built yet, so the
 * burger menu can stay complete without dead-ending the user.
 */
export default function NotFoundScreen() {
  const pathname = usePathname();

  return (
    <View style={styles.root}>
      <MaterialCommunityIcons name="hammer-wrench" size={56} color={colors.primary} />
      <Text style={styles.title}>Coming next</Text>
      <Text style={styles.body}>
        This screen is not built yet.
        {pathname ? `\n(${pathname})` : ''}
      </Text>

      <Pressable
        onPress={() => router.replace('/(tabs)/home')}
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Back to home"
      >
        <Text style={styles.btnText}>Back to Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  title: { ...typography.h1, marginTop: spacing.md },
  body: { ...typography.caption, textAlign: 'center' },
  btn: {
    marginTop: spacing.lg,
    height: 50,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: colors.primaryDark },
  btnText: { ...typography.button, color: colors.onColor },
});
