import { TextStyle } from 'react-native';
import { colors } from './colors';

/**
 * Type scale. Deliberately large: the target user is a first-time smartphone
 * user, so nothing below 13px and body copy sits at 16px.
 */
export const typography = {
  hero: { fontSize: 26, fontWeight: '700', color: colors.onColor },
  h1: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  h2: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  h3: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: 16, fontWeight: '400', color: colors.textPrimary },
  bodyStrong: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  caption: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  captionStrong: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  button: { fontSize: 16, fontWeight: '700' },
  amount: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
