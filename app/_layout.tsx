import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { paperTheme } from '../src/constants/theme';
import { colors } from '../src/constants/colors';

/**
 * Root layout: theme + safe-area providers and the top-level stack.
 * Individual screens draw their own headers, so the native header is off.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider
        theme={paperTheme}
        // Paper renders icons through react-native-vector-icons by default;
        // pointing it at @expo/vector-icons keeps it working inside Expo Go.
        settings={{
          icon: ({ name, color, size }) => (
            <MaterialCommunityIcons name={name as never} color={color} size={size} />
          ),
        }}
      >
        {/* Android is always edge-to-edge from SDK 57, so the bar takes no
            colour of its own - the brand band behind it shows through. */}
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="attendance/manual-entry"
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="attendance/auto-hajari"
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="attendance/list" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="attendance/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="admin/new-saathi"
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen name="admin/employees" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="admin/saathi/[id]" options={{ animation: 'slide_from_right' }} />
        </Stack>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
