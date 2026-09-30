import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../src/constants/colors';

/**
 * Signed-in section. Navigation is driven by the burger menu in the hero
 * header, so this is a plain stack; it can become a Tabs navigator once the
 * attendance / reports / profile screens exist.
 */
export default function SignedInLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
