import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BurgerMenu, Calendar, Card, HeroHeader, HeroStat, Loader } from '../../src/components';
import { colors } from '../../src/constants/colors';
import { radius, spacing } from '../../src/constants/spacing';
import { typography } from '../../src/constants/typography';
import { refreshPendingCount, syncNow } from '../../src/services/sync';
import { useAuth } from '../../src/hooks/useAuth';
import { useSyncStore } from '../../src/store/syncStore';
import { useMonthMarks, useOverview } from '../../src/hooks/useAttendance';
import { currentMonth, greeting, prettyDate, today } from '../../src/utils/date';

/**
 * Home screen.
 *
 * Hero header (burger / logo / add-Saathi) sits above a month calendar.
 * Tapping any date opens the attendance form with that date pre-filled.
 */
export default function HomeScreen() {
  const { status, user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(today());

  const { marks, loading: marksLoading, reload: reloadMarks } = useMonthMarks(month);
  const syncing = useSyncStore((s) => s.phase === 'syncing');
  const adopted = useSyncStore((s) => s.adopted);
  const clearAdopted = useSyncStore((s) => s.clearAdopted);
  const { stats, reload: reloadStats } = useOverview();

  // Re-read the database whenever the screen comes back into focus, so dots
  // and counts reflect entries made on the attendance form.
  useFocusEffect(
    useCallback(() => {
      void reloadMarks();
      void reloadStats();
      // Keeps the hero's "N changes waiting" honest after a write made on
      // another screen, without touching the network.
      void refreshPendingCount(user?.id ?? null);
    }, [reloadMarks, reloadStats, user?.id]),
  );

  // Adoption runs inside the first sync, which is fire-and-forget - so on an
  // upgraded device it can finish after Home has already read an empty
  // register. Without this, the calendar and the stats stay at zero until the
  // user happens to navigate away and back.
  useEffect(() => {
    if (!adopted) return;
    void reloadMarks();
    void reloadStats();
  }, [adopted, reloadMarks, reloadStats]);

  // The session is restored on the splash screen; anyone landing here without
  // one gets sent to login.
  if (status === 'unauthenticated') return <Redirect href="/(auth)/login" />;
  if (status !== 'authenticated') {
    return (
      <View style={styles.centered}>
        <Loader label="Loading your home..." />
      </View>
    );
  }

  const openAttendanceForm = (date: string) => {
    setSelectedDate(date);
    router.push({ pathname: '/attendance/manual-entry', params: { date } });
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const firstName = user?.name?.split(' ')[0] ?? '';

  return (
    <View style={styles.root}>
      <HeroHeader
        onOpenMenu={() => setMenuOpen(true)}
        onAddEmployee={() => router.push('/admin/new-saathi')}
      >
        <Text style={styles.greeting}>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </Text>
        <Text style={styles.todayText}>{prettyDate(today())}</Text>

        <View style={styles.statRow}>
          <HeroStat value={stats?.totalSaathi ?? 0} label="Total Saathi" />
          <HeroStat value={stats?.presentToday ?? 0} label="Present today" />
          <HeroStat
            value={stats?.pendingToday ?? 0}
            label="Not marked"
            tone={stats && stats.pendingToday > 0 ? 'warning' : 'default'}
          />
        </View>
      </HeroHeader>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={marksLoading || syncing}
            onRefresh={() => {
              // Pull-to-refresh is the manual sync: send local changes up and
              // bring the other device's marks down, then re-read.
              void (async () => {
                await syncNow({ force: true });
                await reloadMarks();
                await reloadStats();
              })();
            }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* One-time notice: the records this phone already held were handed
            to this account by the first sync. The user never asked for that,
            so they are told rather than left to notice. */}
        {adopted && adopted > 0 ? (
          <Pressable
            onPress={clearAdopted}
            style={styles.adoptedBanner}
            accessibilityRole="button"
            accessibilityLabel={`Your ${adopted} existing records have been added to this account. Tap to dismiss.`}
          >
            <MaterialCommunityIcons name="cloud-check" size={20} color={colors.primaryDark} />
            <Text style={styles.adoptedText}>
              Your {adopted} existing {adopted === 1 ? 'record has' : 'records have'} been added to
              this account.
            </Text>
            <MaterialCommunityIcons name="close" size={18} color={colors.primaryDark} />
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => openAttendanceForm(today())}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel="Mark today's attendance"
        >
          <MaterialCommunityIcons name="calendar-check" size={26} color={colors.onColor} />
          <View style={styles.ctaText}>
            <Text style={styles.ctaTitle}>Mark today&apos;s attendance</Text>
            <Text style={styles.ctaSubtitle}>
              {stats && stats.pendingToday > 0
                ? `${stats.pendingToday} Saathi still to mark`
                : 'Everyone is marked for today'}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={26} color={colors.onColor} />
        </Pressable>

        <Card
          title="Attendance Calendar"
          subtitle="Tap any day to fill the attendance form"
          style={styles.calendarCard}
        >
          <Calendar
            month={month}
            marks={marks}
            selectedDate={selectedDate}
            onSelectDate={openAttendanceForm}
            onMonthChange={setMonth}
          />
        </Card>
      </ScrollView>

      <BurgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onNavigate={(route) => router.push(route as never)}
        onSignOut={handleSignOut}
        userName={user?.name}
        userPhone={user?.phone}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  adoptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
  },
  adoptedText: { ...typography.caption, color: colors.primaryDark, flex: 1 },

  root: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },

  greeting: { ...typography.hero, fontSize: 22 },
  todayText: {
    ...typography.caption,
    color: colors.onColor,
    opacity: 0.85,
    marginTop: 2,
  },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

  body: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.secondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  ctaPressed: { opacity: 0.85 },
  ctaText: { flex: 1 },
  ctaTitle: { ...typography.bodyStrong, color: colors.onColor },
  ctaSubtitle: {
    ...typography.caption,
    color: colors.onColor,
    opacity: 0.9,
    marginTop: 1,
  },

  calendarCard: { paddingHorizontal: spacing.md },
});
