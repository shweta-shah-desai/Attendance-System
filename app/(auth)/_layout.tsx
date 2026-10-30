import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../src/constants/colors';

/**
 * The auth flow: sign in, create a register, and the SMS-code and new-PIN
 * steps that the forgotten-PIN path runs through. Every screen draws the same
 * brand backdrop, so they cross-fade rather than slide.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.primary },
        animation: 'fade',
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="forgot-pin" />
      <Stack.Screen name="reset-pin" />
    </Stack>
  );
}
