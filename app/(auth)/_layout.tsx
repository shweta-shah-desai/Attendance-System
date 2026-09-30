import React from 'react';
import { Stack } from 'expo-router';
import { colors } from '../../src/constants/colors';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.primary },
      }}
    />
  );
}
