import { MD3LightTheme, configureFonts } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { colors } from './colors';
import { radius } from './spacing';

const fontConfig = {
  default: { fontFamily: 'System', letterSpacing: 0 },
};

/** react-native-paper theme wired to the GharSaathi+ palette. */
export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  roundness: radius.md / 4,
  fonts: configureFonts({ config: fontConfig.default }),
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: colors.onColor,
    primaryContainer: colors.primaryTint,
    onPrimaryContainer: colors.primaryDark,
    secondary: colors.secondary,
    onSecondary: colors.onColor,
    secondaryContainer: '#FBEEE3',
    onSecondaryContainer: '#8A4513',
    error: colors.error,
    onError: colors.onColor,
    errorContainer: '#FDECEC',
    background: colors.background,
    onBackground: colors.textPrimary,
    surface: colors.surface,
    onSurface: colors.textPrimary,
    surfaceVariant: colors.primaryTint,
    onSurfaceVariant: colors.textSecondary,
    outline: colors.border,
    outlineVariant: colors.border,
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level0: 'transparent',
      level1: colors.surface,
      level2: colors.surface,
      level3: colors.surface,
    },
  },
};
