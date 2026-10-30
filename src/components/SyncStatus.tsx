import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import { syncNow } from '../services/sync';
import { isCloudConfigured } from '../services/supabase';
import { useSyncStore } from '../store/syncStore';
import { sinceStamp } from '../utils/date';

/**
 * One line inside the hero telling the user where their register actually is.
 *
 * A backup the user cannot see is a backup they cannot trust: a silent sync
 * looks exactly like a broken one. So this says which of the four states the
 * register is in - going up now, all up, waiting to go up, or stuck - and
 * tapping it retries, which is the only action available anyway.
 *
 * Renders nothing when the cloud is unconfigured; that build is the old
 * offline-only app and has nothing to report.
 */
export function SyncStatus() {
  const phase = useSyncStore((s) => s.phase);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  if (!isCloudConfigured()) return null;

  const { icon, text } = describe(phase, pendingCount, lastSyncedAt);

  return (
    <Pressable
      onPress={() => void syncNow({ force: true })}
      disabled={phase === 'syncing'}
      hitSlop={8}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={`${text}. Tap to sync now.`}
    >
      <MaterialCommunityIcons name={icon} size={14} color={colors.onColor} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

type Described = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  text: string;
};

function describe(
  phase: ReturnType<typeof useSyncStore.getState>['phase'],
  pendingCount: number,
  lastSyncedAt: string | null,
): Described {
  if (phase === 'syncing') return { icon: 'cloud-sync-outline', text: 'Saving to cloud...' };

  // The pending count outranks the error text: "3 changes waiting" tells the
  // user what matters to them, which is that nothing has been lost.
  if (pendingCount > 0) {
    return {
      icon: phase === 'error' ? 'cloud-off-outline' : 'cloud-upload-outline',
      text: `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} waiting`,
    };
  }
  if (phase === 'error') return { icon: 'cloud-off-outline', text: 'Not saved to cloud yet' };
  if (lastSyncedAt) {
    return { icon: 'cloud-check-outline', text: `Saved to cloud - ${sinceStamp(lastSyncedAt)}` };
  }
  return { icon: 'cloud-outline', text: 'Checking the cloud...' };
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.caption,
    color: colors.onColor,
    opacity: 0.85,
  },
});
