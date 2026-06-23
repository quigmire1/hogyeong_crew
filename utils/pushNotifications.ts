import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerPushToken(userId: string) {
  if (Platform.OS === 'web') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('hike-reminders', {
      name: '덩산 리마인드',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = (current as { granted?: boolean }).granted
    ? current
    : await Notifications.requestPermissionsAsync();
  if (!(permission as { granted?: boolean }).granted) return;

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;

  const { error } = await supabase
    .from('app_push_tokens')
    .upsert({
      user_id: userId,
      token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'token' });

  if (error) {
    console.warn('[Push] Failed to save push token:', error.message);
  }
}
