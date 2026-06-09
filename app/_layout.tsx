import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { initDB } from '@/utils/database';
import { restoreCloudBackupToLocal } from '@/utils/sync';

// Background Task가 가장 먼저 등록되도록 import
import '@/tasks/locationTask';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [dbReady, setDbReady] = useState(false);
  const restoredUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // DB 초기화
    initDB()
      .then(() => setDbReady(true))
      .catch(console.error);
  }, []);

  useEffect(() => {
    const userId = session?.user?.id ?? null;
    if (!dbReady || !userId || restoredUserIdRef.current === userId) {
      return;
    }

    restoredUserIdRef.current = userId;
    restoreCloudBackupToLocal().catch((error) => {
      console.error('[RootLayout] Failed to restore cloud backup:', error);
    });
  }, [dbReady, session?.user?.id]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      // 인증되지 않았는데 다른 화면에 있다면 로그인 화면으로 리다이렉트
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      // 이미 인증되었는데 로그인 화면에 있다면 탭 화면으로 리다이렉트
      router.replace('/(tabs)');
    }
  }, [session, isLoading, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="records" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
