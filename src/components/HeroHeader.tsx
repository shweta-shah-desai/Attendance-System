import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LogoLink } from './LogoLink';
import { colors } from '../constants/colors';
import { radius, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';

interface Props {
  /** Burger menu, top-left. */
  onOpenMenu: () => void;
  /** "+" add-employee action, top-right. Hidden when omitted. */
  onAddEmployee?: () => void;
  /** Greeting / stats rendered inside the hero, below the icon row. */
  children?: React.ReactNode;
}

/**
 * Hero header used at the top of the Home screen:
 * burger (left) - logo (centre) - plus (right), on the brand teal band.
 */
/**
 * Wordmark width on Home. Wider than the 112 the other headers use: the
 * tightest case here is a 320pt screen with the burger and the plus, which
 * leaves 320 - 32 of hero padding - 52 x 2 of icons - 16 of the logo button's
 * own padding = 168pt for it.
 */
const HERO_LOGO_WIDTH = 160;

export function HeroHeader({ onOpenMenu, onAddEmployee, children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}>
      {/* Burger then logo, matching ScreenHeader. Home is the one screen
          with nothing to go back to, so it has no back arrow. */}
      <View style={styles.bar}>
        <IconButton
          icon="menu"
          label="Open menu"
          onPress={onOpenMenu}
          testID="hero-burger"
        />
        {/* Home carries no back arrow, so the bar has room for a bigger
            wordmark here than the other screens can give it. */}
        <LogoLink width={HERO_LOGO_WIDTH} />

        <View style={styles.spacer} />
        {onAddEmployee ? (
          <IconButton
            icon="plus"
            label="Add new Saathi"
            onPress={onAddEmployee}
            emphasised
            testID="hero-add"
          />
        ) : null}
      </View>

      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
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

/** Small translucent stat pill used inside the hero. */
export function HeroStat({
  value,
  label,
  tone = 'default',
}: {
  value: string | number;
  label: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <View style={[styles.stat, tone === 'warning' && styles.statWarning]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  bar: {
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
  iconBtnEmphasised: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  iconBtnPressed: { backgroundColor: colors.primaryDark },
  spacer: { flex: 1 },

  body: { marginTop: spacing.lg },

  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statWarning: { backgroundColor: 'rgba(217,119,46,0.30)' },
  statValue: { ...typography.h2, color: colors.onColor },
  statLabel: {
    ...typography.caption,
    color: colors.onColor,
    opacity: 0.85,
    marginTop: 2,
    textAlign: 'center',
  },
});
