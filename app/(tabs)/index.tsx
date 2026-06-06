import { ScrollView, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { WeatherWidget } from '@/components/WeatherWidget';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'expo-router';
import { getAllSessions, getLocationsBySession, getPhotosBySession } from '@/utils/database';
import { calculateElevationGain } from '@/utils/elevation';
import { RECOMMENDED_TRAILS } from '@/constants/trails';

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState({ sessions: 0, elevationGain: 0, photoCount: 0 });

  const displayName = user?.user_metadata?.full_name
    ?? user?.user_metadata?.name
    ?? user?.email?.split('@')[0]
    ?? '크루원';

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadStats = async () => {
        try {
          const sessions = await getAllSessions();
          const sessionDetails = await Promise.all(
            sessions.map(async (session) => {
              const [locations, photos] = await Promise.all([
                getLocationsBySession(session.id),
                getPhotosBySession(session.id),
              ]);

              return { locations, photos };
            }),
          );

          if (!isActive) {
            return;
          }

          const elevationGain = sessionDetails.reduce(
            (sum, detail) => sum + calculateElevationGain(detail.locations),
            0,
          );
          const photoCount = sessionDetails.reduce(
            (sum, detail) => sum + detail.photos.length,
            0,
          );

          setStats({
            sessions: sessions.length,
            elevationGain: Math.floor(elevationGain),
            photoCount,
          });
        } catch {
          // DB 읽기 실패시 기본값 유지
        }
      };

      loadStats();

      return () => {
        isActive = false;
      };
    }, []),
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* 상단 헤더 그라데이션 */}
      <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.greeting}>안녕하세요 👋</Text>
            <Text style={styles.username}>{displayName}님</Text>
          </View>
          <TouchableOpacity
            style={styles.startButton}
            onPress={() => router.push('/(tabs)/tracker')}
          >
            <FontAwesome name="play" size={14} color="#1DB954" />
            <Text style={styles.startButtonText}>덩산 시작</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.quickStats}>
          <View style={styles.quickStat}>
            <Text style={styles.quickStatValue}>{stats.sessions}</Text>
            <Text style={styles.quickStatLabel}>덩산 세션</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.quickStat}>
            <Text style={styles.quickStatValue}>{stats.photoCount}장</Text>
            <Text style={styles.quickStatLabel}>찍은 사진</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.quickStat}>
            <Text style={styles.quickStatValue}>{stats.elevationGain}m</Text>
            <Text style={styles.quickStatLabel}>누적 고도</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.content}>
        {/* 날씨 + 유의성 테스트 카드 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>오늘의 날씨 & 안전 지수</Text>
          <Text style={styles.sectionSub}>현재 위치 기준</Text>
        </View>
        <WeatherWidget />

        {/* 덩산 기록 메뉴 */}
        <TouchableOpacity
          style={styles.recordBanner}
          onPress={() => router.push('/records')}
          activeOpacity={0.85}
        >
          <View style={styles.recordBannerLeft}>
            <View style={styles.recordBannerIcon}>
              <FontAwesome name="history" size={20} color="#1DB954" />
            </View>
            <View>
              <Text style={styles.recordBannerTitle}>내 덩산 기록</Text>
              <Text style={styles.recordBannerSub}>경로 지도 · 고도 · 사진 · 그룹 기록</Text>
            </View>
          </View>
          <FontAwesome name="chevron-right" size={14} color="#CCC" />
        </TouchableOpacity>

        {/* 추천 코스 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>추천 코스 🗺️</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.courseScroll}>
          {RECOMMENDED_TRAILS.map((c) => (
            <View key={c.name} style={styles.courseCard}>
              <Text style={styles.courseEmoji}>{c.emoji}</Text>
              <Text style={styles.courseName}>{c.name}</Text>
              <View style={styles.courseDetails}>
                <Text style={styles.courseStat}>📏 {c.dist}</Text>
                <Text style={styles.courseStat}>⏱️ {c.time}</Text>
              </View>
              <View style={[styles.diffBadge, {
                backgroundColor: c.diff === '어려움' ? '#FDEDEC' : c.diff === '보통' ? '#FEF9E7' : '#E8F8EE'
              }]}>
                <Text style={[styles.diffText, {
                  color: c.diff === '어려움' ? '#E74C3C' : c.diff === '보통' ? '#F39C12' : '#1DB954'
                }]}>{c.diff}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 30,
    paddingHorizontal: 22,
    gap: 20,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  username: {
    fontSize: 26,
    color: '#FFF',
    fontWeight: '900',
    marginTop: 2,
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
  },
  startButtonText: {
    color: '#1DB954',
    fontWeight: '700',
    fontSize: 14,
  },
  quickStats: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 16,
  },
  quickStat: {
    flex: 1,
    alignItems: 'center',
  },
  quickStatValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFF',
  },
  quickStatLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 4,
  },
  content: {
    padding: 18,
    paddingTop: 22,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
  },
  sectionSub: {
    fontSize: 12,
    color: '#999',
  },
  courseScroll: {
    marginTop: 12,
    marginHorizontal: -18,
    paddingHorizontal: 18,
  },
  courseCard: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 18,
    marginRight: 14,
    width: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 20,
    gap: 8,
  },
  courseEmoji: {
    fontSize: 36,
  },
  courseName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111',
  },
  courseDetails: {
    gap: 3,
  },
  courseStat: {
    fontSize: 12,
    color: '#777',
  },
  diffBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  diffText: {
    fontSize: 12,
    fontWeight: '700',
  },
  recordBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    marginBottom: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  recordBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  recordBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E8F8EE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordBannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  recordBannerSub: {
    fontSize: 12,
    color: '#999',
    marginTop: 3,
  },
});
