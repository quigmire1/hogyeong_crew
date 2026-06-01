import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../utils/supabase';

// OAuth 인증 후 브라우저 세션 완료 처리
WebBrowser.maybeCompleteAuthSession();

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { url } = useLocalSearchParams<{ url?: string | string[] }>();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const callbackUrl = Array.isArray(url) ? url[0] : url;
        const resolvedUrl = callbackUrl || await Linking.getInitialURL();

        if (resolvedUrl) {
          const query = resolvedUrl.split('?')[1]?.split('#')[0] ?? '';
          const hash = resolvedUrl.split('#')[1] ?? '';
          const params = new URLSearchParams(hash);
          new URLSearchParams(query).forEach((value, key) => {
            params.set(key, value);
          });

          const authError = params.get('error_description') || params.get('error');
          if (authError) {
            throw new Error(authError);
          }

          const code = params.get('code');
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
          } else if (accessToken && refreshToken) {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
          }
        }

        const { data: { session } } = await supabase.auth.getSession();
        router.replace(session ? '/(tabs)' : '/(auth)/login');
      } catch (error) {
        Alert.alert(
          '로그인 실패',
          error instanceof Error ? error.message : '인증 정보를 처리하지 못했습니다.',
        );
        router.replace('/(auth)/login');
      }
    };

    handleCallback();
  }, [router, url]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2ECC71" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
