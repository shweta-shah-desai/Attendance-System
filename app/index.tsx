import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Loader } from '../src/components';
import { colors } from '../src/constants/colors';
import { spacing } from '../src/constants/spacing';
import { typography } from '../src/constants/typography';
import { initDatabase } from '../src/db/client';
import { useAuthStore } from '../src/store/authStore';

/**
 * The calendar/tick/fingerprint mark on a light disc, cropped out of the
 * brand artwork by scripts/build-splash-mark.mjs. The mark's own navy is
 * near-identical to Primary, hence the disc it is baked onto.
 */
const SPLASH_MARK = require('../assets/images/splash-mark.png');

/** Minimum time the splash stays up, so it never flashes past too fast. */
const MIN_VISIBLE_MS = 8000;

type Phase = 'starting' | 'failed';

/**
 * Splash / startup screen.
 *
 * Opens the SQLite database and restores any saved session while the brand
 * lockup is on screen, then routes to Home if a session is active and to
 * Login if it is not.
 */
export default function SplashScreen() {
  const restore = useAuthStore((s) => s.restore);
  const [phase, setPhase] = useState<Phase>('starting');
  const [message, setMessage] = useState('Getting things ready...');
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fade]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const startedAt = Date.now();
      try {
        setMessage('Opening your register...');
        await initDatabase();

        if (cancelled) return;
        setMessage('Checking your login...');
        const status = await restore();

        // Hold the splash for the remainder of MIN_VISIBLE_MS.
        const elapsed = Date.now() - startedAt;
        if (elapsed < MIN_VISIBLE_MS) {
          await new Promise((resolve) => setTimeout(resolve, MIN_VISIBLE_MS - elapsed));
        }
        if (cancelled) return;

        router.replace(status === 'authenticated' ? '/(tabs)/home' : '/(auth)/login');
      } catch (error) {
        if (cancelled) return;
        // A failed boot must not leave a frozen splash - tell the user and
        // let them into the login screen, which will retry the database.
        console.error('Startup failed', error);
        setPhase('failed');
        setMessage('Could not start the app. Please close and open it again.');
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [restore]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.lockup, { opacity: fade }]}>
        {/* Decorative - the name is spelled out in the text below. */}
        <Image
          source={SPLASH_MARK}
          style={styles.mark}
          resizeMode="contain"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />

        <Text style={styles.brand} accessibilityRole="header">
          G<Text style={styles.brandAccent}>har</Text>Saathi
          <Text style={styles.brandAccent}>+</Text>
        </Text>
        <Text style={styles.title}>Attendance System</Text>
        <Text style={styles.tagline}>
          Log and monitor on-site attendance with ease for home and service helpers.
        </Text>
      </Animated.View>

      <View style={styles.footer}>
        {phase === 'starting' ? (
          <Loader onDark label={message} />
        ) : (
          <Text style={styles.errorText}>{message}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockup: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  mark: {
    width: 168,
    height: 168,
    marginBottom: spacing.xxxl,
  },
  brand: {
    ...typography.hero,
    fontSize: 34,
    letterSpacing: 0.4,
  },
  brandAccent: { color: colors.secondaryOnColor },
  title: {
    ...typography.h2,
    color: colors.onColor,
    marginTop: spacing.sm,
  },
  tagline: {
    ...typography.body,
    color: colors.onColor,
    opacity: 0.85,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  footer: {
    paddingBottom: spacing.huge,
    minHeight: 110,
    justifyContent: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.onColor,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
