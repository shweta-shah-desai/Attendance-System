import React from 'react';
import { Image, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { spacing } from '../constants/spacing';

/**
 * White wordmark for the brand band. Built by scripts/build-logos.mjs -
 * assets/images/logo.png cannot be used directly, it has a grey checkerboard
 * baked into its pixels.
 */
const LOGO = require('../../assets/images/logo-on-dark.png');

interface Props {
  /**
   * Width of the wordmark. Height follows its 6.19:1 aspect ratio.
   *
   * The header lays out back, burger and logo in a row, so the tightest case
   * is a 320pt screen carrying all three plus a right-hand action: inside the
   * 304pt row, 52 x 3 of icons and 16 of this button's own padding leave 132pt
   * for the wordmark, so the 112 default still has room to spare.
   */
  width?: number;
}

/**
 * The wordmark, as a link back to Home. Sits in the header of every screen.
 *
 * `navigate` rather than `push` so tapping it from a screen that is already
 * above Home in the stack returns to it instead of stacking a second copy.
 */
export function LogoLink({ width = 112 }: Props) {
  return (
    <Pressable
      onPress={() => router.navigate('/(tabs)/home')}
      // The drawn wordmark is only ~13pt tall, so the touch target comes from
      // the padding plus vertical slop. No horizontal slop - it would reach
      // under the back button on a narrow screen and swallow its taps.
      hitSlop={{ top: 10, bottom: 10 }}
      accessibilityRole="link"
      accessibilityLabel="GharSaathi+, go to Home"
      testID="header-logo"
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <Image
        source={LOGO}
        style={{ width, height: width / 6.19 }}
        resizeMode="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
});
