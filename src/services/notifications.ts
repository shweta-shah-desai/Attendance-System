import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const REMINDER_ID = 'daily-attendance-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Schedules (or re-schedules) the once-a-day nudge to mark attendance.
 * `time` is "HH:mm" in the phone's local timezone.
 */
export async function scheduleDailyReminder(time: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const granted = await requestPermission();
  if (!granted) return false;

  const [hour, minute] = time.split(':').map(Number);
  await cancelDailyReminder();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Daily reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'GharSaathi+',
      body: "Aaj ki haazri bhari? Tap to mark today's attendance.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Number.isFinite(hour) ? hour : 20,
      minute: Number.isFinite(minute) ? minute : 0,
      channelId: 'reminders',
    },
  });
  return true;
}

export async function cancelDailyReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    // Nothing scheduled yet - safe to ignore.
  }
}

export async function hasScheduledReminder(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all.some((n) => n.identifier === REMINDER_ID);
}
