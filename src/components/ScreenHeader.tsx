import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BurgerMenu } from './BurgerMenu';
import { LogoLink } from './LogoLink';
import { colors } from '../constants/colors';
import { radius, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import { useAuth } from '../hooks/useAuth';

export interface HeaderAction {
  icon: string;
  label: string;
  onPress: () => void;
  testID?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  /** Back arrow beside the burger. Off for screens with nothing beneath them. */
  showBack?: boolean;
  /** Optional icon button on the right of the bar. */
  action?: HeaderAction;
}

/**
 * Standard header for every screen below Home: burger and back on the left,
 * the wordmark centred and linking Home, an optional action on the right,
 * with the screen title on its own row underneath.
 *
 * It owns the drawer, so a screen only has to render the header to get the
 * whole navigation menu - Home does the same job through HeroHeader, which
 * carries the greeting and stats as well.
 */
export function ScreenHeader({ title, subtitle, showBack = true, action }: Props) {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <>
      <View style={[styles.bar, { paddingTop: insets.top + spacing.sm }]}>
        {/* Back, burger, logo - in that order, left to right. */}
        <View style={styles.iconRow}>
          {showBack ? (
            <IconButton
              icon="arrow-left"
              label="Go back"
              onPress={() => router.back()}
              testID="header-back"
            />
          ) : null}
          <IconButton
            icon="menu"
            label="Open menu"
            onPress={() => setMenuOpen(true)}
            testID="header-burger"
          />
          <LogoLink />

          <View style={styles.spacer} />
          {action ? (
            <IconButton
              icon={action.icon}
              label={action.label}
              onPress={action.onPress}
              testID={action.testID}
              emphasised
            />
          ) : null}
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <BurgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(route) => router.push(route as never)}
        onSignOut={handleSignOut}
        userName={user?.name}
        userPhone={user?.phone}
      />
    </>
  );
}

interface IconButtonProps {
  icon: string;
  label: string;
  onPress: () => void;
  emphasised?: boolean;
  testID?: string;
}

function IconButton({ icon, label, onPress, emphasised, testID }: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        emphasised && styles.iconBtnEmphasised,
        pressed && styles.iconBtnPressed,
      ]}
    >
      <MaterialCommunityIcons name={icon as never} size={26} color={colors.onColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MIN_TOUCH,
  },
  iconBtn: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnEmphasised: { backgroundColor: 'rgba(255,255,255,0.18)' },
  iconBtnPressed: { backgroundColor: colors.primaryDark },
  spacer: { flex: 1 },

  titleRow: { paddingHorizontal: spacing.sm, marginTop: spacing.xs },
  title: { ...typography.h2, color: colors.onColor },
  subtitle: { ...typography.caption, color: colors.onColor, opacity: 0.85 },
});
