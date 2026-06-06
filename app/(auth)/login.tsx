import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { supabase } from '../../utils/supabase';

// WebBrowser 닫기 처리를 위해 필요
WebBrowser.maybeCompleteAuthSession();

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [kakaoLoading, setKakaoLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  async function signInWithEmail() {
    if (!email || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) Alert.alert('로그인 실패', error.message);
    } catch (error) {
      Alert.alert('로그인 실패', error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function signUpWithEmail() {
    if (!email || !password) {
      Alert.alert('입력 오류', '이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) Alert.alert('가입 실패', error.message);
      else Alert.alert('가입 성공! 🎉', '이메일 인증 메일을 확인해주세요.');
    } catch (error) {
      Alert.alert('가입 실패', error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function signInWithKakao() {
    setKakaoLoading(true);
    try {
      // Expo Go에서는 exp://.../--/auth/callback, dev build/standalone에서는
      // hogyeongcrew://auth/callback으로 돌아오게 처리합니다.
      const nativeRedirectUrl = 'hogyeongcrew://auth/callback';
      const redirectPath = 'auth/callback';
      const redirectUrl = AuthSession.makeRedirectUri({
        native: nativeRedirectUrl,
        scheme: 'hogyeongcrew',
        path: redirectPath,
      });

      console.log('--- Kakao Login Debug ---');
      console.log('1. Redirect URL (Wait for this):', redirectUrl);
      console.log('[Kakao Login] Native Redirect URL:', nativeRedirectUrl);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        Alert.alert('카카오 로그인 에러', error.message);
        return;
      }

      if (!data?.url) {
        Alert.alert('에러', '카카오 로그인 URL을 가져올 수 없습니다.');
        return;
      }

      console.log('2. Supabase Auth URL:', data.url);
      console.log('-------------------------');

      let callbackUrl: string | null = null;
      const isCallbackUrl = (url?: string | null): url is string => {
        if (!url) return false;
        return (
          url.startsWith(redirectUrl) ||
          url.startsWith(nativeRedirectUrl) ||
          url.includes(`/--/${redirectPath}`)
        );
      };
      const routeToCallback = (url: string) => {
        callbackUrl = url;
        console.log('[Kakao Login] Routing callback URL:', url);
        router.replace({
          pathname: '/auth/callback',
          params: { url },
        });
      };

      const subscription = Linking.addEventListener('url', ({ url }) => {
        console.log('[Kakao Login] Linking URL event:', url);
        if (isCallbackUrl(url)) {
          routeToCallback(url);
        }
      });

      try {
        // 시스템 브라우저로 카카오 로그인 페이지 열기
        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
        console.log('[Kakao Login] WebBrowser auth result:', result);

        if (result.type === 'success') {
          routeToCallback(result.url);
        } else if (result.type === 'cancel') {
          // 사용자가 로그인 취소
          console.log('사용자가 로그인을 취소했습니다.');
        } else if (result.type === 'dismiss') {
          await wait(800);
          const initialUrl = await Linking.getInitialURL();
          console.log('[Kakao Login] Callback URL from listener:', callbackUrl);
          console.log('[Kakao Login] Initial URL after dismiss:', initialUrl);

          if (callbackUrl) {
            console.log('인증 브라우저가 닫혔지만 callback 딥링크를 수신했습니다.');
          } else if (isCallbackUrl(initialUrl)) {
            routeToCallback(initialUrl);
          } else {
            Alert.alert('로그인 중단', '인증 창이 닫혔습니다. 다시 시도해주세요.');
          }
        } else if (result.type === 'locked') {
          Alert.alert('로그인 에러', '브라우저가 잠겨있어 로그인을 진행할 수 없습니다.');
        } else {
          Alert.alert('로그인 실패', `카카오 로그인이 완료되지 않았습니다. (상태 코드: ${result.type})`);
        }
      } finally {
        subscription.remove();
      }
    } catch (error) {
      Alert.alert('에러', error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setKakaoLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: isDark ? '#0D0D0D' : '#F5F7FA' }}
      >
        {/* 상단 배경 그라데이션 */}
        <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.headerGradient}>
          <View style={styles.logoArea}>
            <Text style={styles.logoEmoji}>⛰️</Text>
            <Text style={styles.logoTitle}>덩산</Text>
            <Text style={styles.logoSubtitle}>근엄한 덩산은 가라.</Text>
          </View>
        </LinearGradient>

        {/* 로그인 카드 */}
        <View style={[styles.card, { backgroundColor: isDark ? '#1A1A1A' : '#FFFFFF' }]}>
          {/* 탭 전환 */}
          <View style={[styles.tabContainer, { backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0' }]}>
            <TouchableOpacity
              style={[styles.tab, !isSignUp && styles.tabActive]}
              onPress={() => setIsSignUp(false)}
            >
              <Text style={[styles.tabText, !isSignUp && styles.tabTextActive]}>로그인</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, isSignUp && styles.tabActive]}
              onPress={() => setIsSignUp(true)}
            >
              <Text style={[styles.tabText, isSignUp && styles.tabTextActive]}>회원가입</Text>
            </TouchableOpacity>
          </View>

          {/* 입력 필드 */}
          <TextInput
            style={[styles.input, { borderColor: isDark ? '#333' : '#E0E0E0', color: isDark ? '#FFF' : '#111', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' }]}
            onChangeText={setEmail}
            value={email}
            placeholder="이메일 주소"
            placeholderTextColor={isDark ? '#555' : '#AAA'}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={[styles.input, { borderColor: isDark ? '#333' : '#E0E0E0', color: isDark ? '#FFF' : '#111', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' }]}
            onChangeText={setPassword}
            value={password}
            secureTextEntry
            placeholder="비밀번호"
            placeholderTextColor={isDark ? '#555' : '#AAA'}
            autoCapitalize="none"
          />

          {/* 이메일 버튼 */}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={isSignUp ? signUpWithEmail : signInWithEmail}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.primaryButtonText}>{isSignUp ? '가입하기' : '로그인'}</Text>
            }
          </TouchableOpacity>

          {/* 구분선 */}
          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: isDark ? '#333' : '#E8E8E8' }]} />
            <Text style={[styles.dividerText, { color: isDark ? '#555' : '#AAA' }]}>또는</Text>
            <View style={[styles.dividerLine, { backgroundColor: isDark ? '#333' : '#E8E8E8' }]} />
          </View>

          {/* 카카오 로그인 버튼 */}
          <TouchableOpacity
            style={[styles.kakaoButton, kakaoLoading && styles.buttonDisabled]}
            onPress={signInWithKakao}
            disabled={kakaoLoading}
            activeOpacity={0.85}
          >
            {kakaoLoading ? (
              <ActivityIndicator color="#3B1D1D" />
            ) : (
              <>
                <Text style={styles.kakaoIcon}>💬</Text>
                <Text style={styles.kakaoButtonText}>
                  {isSignUp ? '카카오톡으로 시작하기' : '카카오톡으로 계속하기'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.termsText, { color: isDark ? '#555' : '#AAA' }]}>
            로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의합니다.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
  },
  headerGradient: {
    paddingTop: 80,
    paddingBottom: 60,
    alignItems: 'center',
  },
  logoArea: {
    alignItems: 'center',
  },
  logoEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  logoTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  logoSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
    fontWeight: '500',
  },
  card: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    padding: 28,
    paddingTop: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 4,
    marginBottom: 28,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#1DB954',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#888',
  },
  tabTextActive: {
    color: '#FFF',
  },
  input: {
    height: 54,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    fontSize: 16,
  },
  primaryButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '500',
  },
  kakaoButton: {
    height: 54,
    borderRadius: 12,
    backgroundColor: '#FEE500',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#FEE500',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  kakaoIcon: {
    fontSize: 22,
  },
  kakaoButtonText: {
    color: '#3B1D1D',
    fontSize: 17,
    fontWeight: '700',
  },
  termsText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18,
  },
});
