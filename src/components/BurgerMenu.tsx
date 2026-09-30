import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { radius, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import { initials, phoneUi } from '../utils/formatters';

/** Navy wordmark - the drawer panel is white. See scripts/build-logos.mjs. */
const LOGO = require('../../assets/images/logo-on-light.png');
const PANEL_WIDTH = Math.min(310, Dimensions.get('window').width * 0.84);

export interface MenuItem {
  key: string;
  label: string;
  icon: string;
  route?: string;
  children?: MenuItem[];
}

/**
 * Menu structure exactly as specified: Home, Saathi, Hajari (Attendance),
 * Report - and inside each group, the "add" screen before the list, because
 * that is the order the work happens in.
 */
export const MENU: MenuItem[] = [
  { key: 'home', label: 'Home', icon: 'home-variant', route: '/(tabs)/home' },
  {
    key: 'saathi',
    label: 'Saathi',
    icon: 'account-group',
    children: [
      {
        key: 'new-saathi',
        label: 'New Saathi',
        icon: 'account-plus',
        route: '/admin/new-saathi',
      },
      {
        key: 'all-saathi',
        label: 'All Saathi',
        icon: 'format-list-bulleted',
        route: '/admin/employees',
      },
    ],
  },
  {
    key: 'attendance',
    label: 'Hajari (Attendance)',
    icon: 'calendar-check',
    children: [
      {
        key: 'auto-attendance',
        label: 'Auto Hajari (Attendance)',
        icon: 'calendar-multiple-check',
        route: '/attendance/auto-hajari',
      },
      {
        key: 'add-attendance',
        label: 'Add Hajari (Attendance)',
        icon: 'calendar-plus',
        route: '/attendance/manual-entry',
      },
      {
        key: 'attendance-list',
        label: 'List',
        icon: 'format-list-bulleted',
        route: '/attendance/list',
      },
    ],
  },
  { key: 'report', label: 'Report', icon: 'chart-box', route: '/(tabs)/reports' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
  onSignOut: () => void;
  userName?: string | null;
  userPhone?: string | null;
}

/**
 * Slide-in navigation drawer opened from the hero header burger icon.
 * Built on Modal + Animated rather than @react-navigation/drawer so it needs
 * no Reanimated setup and can be opened from any screen.
 */
export function BurgerMenu({
  visible,
  onClose,
  onNavigate,
  onSignOut,
  userName,
  userPhone,
}: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState<string | null>('saathi');
  // Keeps the Modal mounted until the close animation has finished.
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.parallel([
      Animated.timing(slide, {
        toValue: visible ? 0 : -PANEL_WIDTH,
        duration: visible ? 240 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: visible ? 1 : 0,
        duration: visible ? 240 : 180,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, slide, fade]);

  if (!mounted) return null;

  const go = (route: string) => {
    onClose();
    onNavigate(route);
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: fade }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            { paddingTop: insets.top + spacing.lg, transform: [{ translateX: slide }] },
          ]}
        >
          <View style={styles.profile}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />

            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{userName ? initials(userName) : '?'}</Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name} numberOfLines={1}>
                  {userName ?? 'Guest'}
                </Text>
                <Text style={styles.phone} numberOfLines={1}>
                  {phoneUi(userPhone)}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {MENU.map((item) => {
              const open = expanded === item.key;
              return (
                <View key={item.key}>
                  <Row
                    icon={item.icon}
                    label={item.label}
                    trailing={
                      item.children ? (
                        <MaterialCommunityIcons
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={22}
                          color={colors.textSecondary}
                        />
                      ) : null
                    }
                    onPress={() =>
                      item.children
                        ? setExpanded(open ? null : item.key)
                        : go(item.route as string)
                    }
                  />
                  {item.children && open
                    ? item.children.map((child) => (
                        <Row
                          key={child.key}
                          icon={child.icon}
                          label={child.label}
                          nested
                          onPress={() => go(child.route as string)}
                        />
                      ))
                    : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Row
              icon="logout"
              label="Logout"
              danger
              onPress={() => {
                onClose();
                onSignOut();
              }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface RowProps {
  icon: string;
  label: string;
  onPress: () => void;
  nested?: boolean;
  danger?: boolean;
  trailing?: React.ReactNode;
}

function Row({ icon, label, onPress, nested, danger, trailing }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        nested && styles.rowNested,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={icon as never}
        size={nested ? 20 : 24}
        color={danger ? colors.error : colors.primary}
      />
      <Text
        style={[
          styles.rowLabel,
          nested && styles.rowLabelNested,
          { color: danger ? colors.error : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  // Spelled out rather than StyleSheet.absoluteFillObject, which SDK 57's
  // React Native no longer exposes.
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  panel: {
    width: PANEL_WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },

  profile: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logo: { width: 96, height: 16, marginBottom: spacing.lg },

  // Avatar sits beside the name and number, so the drawer header reads as
  // two things: the wordmark, then who is signed in.
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h3, color: colors.primary },
  name: typography.h3,
  phone: { ...typography.caption, marginTop: 2 },

  list: { flex: 1 },
  listContent: { paddingVertical: spacing.sm },
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  rowNested: { paddingLeft: spacing.xxxl + spacing.lg, minHeight: 46 },
  rowPressed: { backgroundColor: colors.primaryTint },
  rowLabel: { ...typography.bodyStrong, flex: 1 },
  rowLabelNested: { fontWeight: '500', fontSize: 15 },

  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
