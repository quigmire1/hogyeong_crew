import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Dimensions, FlatList,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome } from '@expo/vector-icons';
import NativeMapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import {
  getAllSessions, getLocationsBySession, getPhotosBySession,
  SessionRecord, LocationRecord, PhotoRecord,
} from '@/utils/database';
import { calculateElevationGain, calculateFloors } from '@/utils/elevation';

const { width } = Dimensions.get('window');

// ─── 유틸: 거리 계산 ─────────────────────────────────────────────────────────
function calcDistanceKm(locs: LocationRecord[]): number {
  if (locs.length < 2) return 0;
  const R = 6371;
  return locs.reduce((acc, cur, i) => {
    if (i === 0) return 0;
    const prev = locs[i - 1];
    const dLat = ((cur.latitude - prev.latitude) * Math.PI) / 180;
    const dLon = ((cur.longitude - prev.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((prev.latitude * Math.PI) / 180) *
        Math.cos((cur.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return acc + R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, 0);
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ─── 세션 카드 데이터 타입 ────────────────────────────────────────────────────
interface SessionSummary {
  session: SessionRecord;
}

// ─── 개별 세션 카드 컴포넌트 ─────────────────────────────────────────────────
const MIN_MAP_DELTA = 0.01;
const PAGE_SIZE = 10;
const getParamString = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
);

const SessionCard = React.memo(({ data, isDark, theme, onReturnToTracker }: {
  data: SessionSummary;
  isDark: boolean;
  theme: any;
  onReturnToTracker: () => void;
}) => {
  const { session } = data;
  const [expanded, setExpanded] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const isActive = session.ended_at === 0;

  const elevationGain = calculateElevationGain(locations);
  const floors = calculateFloors(elevationGain);
  const distanceKm = calcDistanceKm(locations);
  const durationMs = (session.ended_at > 0 ? session.ended_at : Date.now()) - session.started_at;
  const maxAlt = locations.length > 0 ? Math.max(...locations.map((l) => l.altitude)) : 0;
  const coords = locations.map((l) => ({ latitude: l.latitude, longitude: l.longitude }));

  useEffect(() => {
    if (!expanded || locations.length > 0 || detailsLoading) return;

    let isMounted = true;
    setDetailsLoading(true);
    Promise.all([
      getLocationsBySession(session.id),
      getPhotosBySession(session.id),
    ])
      .then(([nextLocations, nextPhotos]) => {
        if (!isMounted) return;
        setLocations(nextLocations);
        setPhotos(nextPhotos);
      })
      .catch((error) => {
        console.error('[Records] Failed to load session details:', error);
      })
      .finally(() => {
        if (isMounted) setDetailsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [detailsLoading, expanded, locations.length, session.id]);

  const mapRegion = locations.length > 0
    ? {
        latitude: locations.reduce((s, l) => s + l.latitude, 0) / locations.length,
        longitude: locations.reduce((s, l) => s + l.longitude, 0) / locations.length,
        latitudeDelta: Math.max(
          Math.max(...locations.map((l) => l.latitude)) - Math.min(...locations.map((l) => l.latitude)) + 0.005,
          MIN_MAP_DELTA,
        ),
        longitudeDelta: Math.max(
          Math.max(...locations.map((l) => l.longitude)) - Math.min(...locations.map((l) => l.longitude)) + 0.005,
          MIN_MAP_DELTA,
        ),
      }
    : null;

  const stats = [
    { label: '이동 거리', value: `${distanceKm.toFixed(2)}km`, icon: 'road', color: '#3498DB' },
    { label: '누적 상승', value: `${Math.floor(elevationGain)}m`, icon: 'arrow-up', color: '#1DB954' },
    { label: '최고 고도', value: `${Math.floor(maxAlt)}m`, icon: 'flag', color: '#E67E22' },
    { label: '환산 층수', value: `${floors}층`, icon: 'building', color: '#9B59B6' },
    { label: '덩산 시간', value: formatDuration(durationMs), icon: 'clock-o', color: '#E74C3C' },
    { label: '사진', value: `${photos.length}장`, icon: 'camera', color: '#1ABC9C' },
  ];

  return (
    <View style={[styles.sessionCard, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
      {isActive && (
        <View style={styles.activeSessionBanner}>
          <View>
            <Text style={styles.activeSessionLabel}>진행 중인 덩산</Text>
            <Text style={styles.activeSessionText}>현재 트래킹 세션이 아직 종료되지 않았습니다.</Text>
          </View>
          <TouchableOpacity style={styles.activeSessionBtn} onPress={onReturnToTracker}>
            <Text style={styles.activeSessionBtnText}>트래킹으로</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 카드 헤더 */}
      <TouchableOpacity style={styles.sessionCardHead} onPress={() => setExpanded(!expanded)} activeOpacity={0.8}>
        <View style={styles.sessionDateRow}>
          <View style={[styles.sessionDot, { backgroundColor: theme.tint }]} />
          <View>
            {session.group_hike_title ? (
              <Text style={styles.groupSessionTitle} numberOfLines={1}>{session.group_hike_title}</Text>
            ) : null}
            <Text style={[styles.sessionDate, { color: theme.text }]}>{formatDate(session.started_at)}</Text>
            <Text style={styles.sessionTime}>
              {formatTime(session.started_at)}
              {session.ended_at > 0 ? ` ~ ${formatTime(session.ended_at)}` : ' (진행 중)'}
            </Text>
          </View>
        </View>
        <View style={styles.sessionQuickStats}>
          <FontAwesome name="clock-o" size={12} color={theme.tint} />
          <Text style={[styles.sessionQuickStat, { color: theme.tint }]}>{formatDuration(durationMs)}</Text>
          <FontAwesome name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color="#CCC" style={{ marginLeft: 6 }} />
        </View>
      </TouchableOpacity>

      {/* 펼쳐지는 상세 정보 */}
      {expanded && (
        <>
          {detailsLoading ? (
            <View style={styles.detailsLoading}>
              <ActivityIndicator size="small" color={theme.tint} />
              <Text style={styles.detailsLoadingText}>기록을 불러오는 중...</Text>
            </View>
          ) : null}

          {/* 미니 맵 */}
          {!detailsLoading && mapRegion && locations.length > 1 ? (
            <View style={styles.miniMapCard}>
              <NativeMapView
                style={styles.miniMap}
                provider={PROVIDER_GOOGLE}
                region={mapRegion}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
              >
                <Polyline coordinates={coords} strokeColor={theme.tint} strokeWidth={3} />
                <Marker coordinate={coords[0]} title="출발" pinColor="#3498DB" />
                <Marker coordinate={coords[coords.length - 1]} title="도착" pinColor="#E74C3C" />
              </NativeMapView>
            </View>
          ) : !detailsLoading ? (
            <View style={styles.miniMapEmpty}>
              <Text style={styles.miniMapEmptyText}>🗺️ 경로 데이터가 부족합니다</Text>
            </View>
          ) : null}

          {/* 통계 그리드 */}
          <View style={styles.statsGrid}>
            {stats.map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: isDark ? '#252525' : '#F8F9FA' }]}>
                <View style={[styles.statIcon, { backgroundColor: s.color + '20' }]}>
                  <FontAwesome name={s.icon as any} size={14} color={s.color} />
                </View>
                <Text style={[styles.statValue, { color: theme.text }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* 사진 스니펫 */}
          {photos.length > 0 && (
            <>
              <Text style={[styles.subTitle, { color: theme.text }]}>사진 📷</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
                {photos.map((p, i) => (
                  <View key={i} style={styles.photoCard}>
                    <Image source={{ uri: p.local_uri }} style={styles.photoImg} />
                    <Text style={styles.photoMeta}>{formatTime(p.timestamp)}</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </>
      )}
    </View>
  );
});
SessionCard.displayName = 'SessionCard';

// ─── 메인 화면 ────────────────────────────────────────────────────────────────
export default function RecordsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupHikeId?: string;
    groupHikeTitle?: string;
  }>();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const groupHikeId = getParamString(params.groupHikeId);
  const groupHikeTitle = getParamString(params.groupHikeTitle);

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    (async () => {
      try {
        const rawSessions = await getAllSessions(); // 최신순
        const filteredSessions = groupHikeId
          ? rawSessions.filter((session) => session.group_hike_id === groupHikeId)
          : rawSessions;
        setSessions(filteredSessions.map((session) => ({ session })));
      } catch (e) {
        console.error('[Records]', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [groupHikeId]);

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F8F9FA' }]}>
      {/* 헤더 */}
      <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <FontAwesome name="chevron-left" size={16} color="#FFF" />
          <Text style={styles.backText}>홈</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{groupHikeId ? '그룹 덩산 기록' : '내 덩산 기록'}</Text>
        <Text style={styles.headerSub}>
          {loading ? '불러오는 중...' : groupHikeTitle ?? (sessions.length > 0 ? `총 ${sessions.length}회 덩산` : '기록된 덩산이 없습니다')}
        </Text>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.tint} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🏔️</Text>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>아직 덩산 기록이 없어요</Text>
          <Text style={styles.emptyDesc}>트래킹 탭에서 덩산을 시작해보세요!</Text>
          <TouchableOpacity
            style={[styles.groupBanner, { marginTop: 24 }]}
            onPress={() => router.push('/(tabs)/groups')}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.groupBannerGradient}>
              <Text style={styles.groupBannerEmoji}>👥</Text>
              <Text style={styles.groupBannerTitle}>그룹 덩산 기록 보기</Text>
              <FontAwesome name="chevron-right" size={13} color="rgba(255,255,255,0.7)" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions.slice(0, visibleCount)}
          keyExtractor={(item) => item.session.id}
          renderItem={({ item }) => (
            <SessionCard
              data={item}
              isDark={isDark}
              theme={theme}
              onReturnToTracker={() => router.push('/(tabs)/tracker')}
            />
          )}
          contentContainerStyle={styles.list}
          onEndReached={() => {
            setVisibleCount((count) => Math.min(count + PAGE_SIZE, sessions.length));
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            <>
              {visibleCount < sessions.length ? (
                <TouchableOpacity
                  style={[styles.loadMoreBtn, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}
                  onPress={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, sessions.length))}
                >
                  <Text style={[styles.loadMoreText, { color: theme.tint }]}>기록 더 보기</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.groupBanner}
                onPress={() => router.push('/(tabs)/groups')}
                activeOpacity={0.85}
              >
                <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.groupBannerGradient}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                    <Text style={styles.groupBannerEmoji}>👥</Text>
                    <View>
                      <Text style={styles.groupBannerTitle}>그룹 덩산 기록</Text>
                      <Text style={styles.groupBannerSub}>크루원들과 함께한 덩산을 확인하세요</Text>
                    </View>
                  </View>
                  <View style={styles.groupBannerRight}>
                    <Text style={styles.groupBannerBtn}>그룹 탭으로 이동</Text>
                    <FontAwesome name="chevron-right" size={11} color="#1DB954" />
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            </>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 55, paddingBottom: 22, paddingHorizontal: 22, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  backText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 18, paddingBottom: 40 },

  // Empty state
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#999', textAlign: 'center' },

  // Session Card
  sessionCard: {
    borderRadius: 20, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    overflow: 'hidden',
  },
  sessionCardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  sessionDateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sessionDot: { width: 10, height: 10, borderRadius: 5 },
  groupSessionTitle: { maxWidth: width - 180, color: '#1DB954', fontSize: 12, fontWeight: '800', marginBottom: 2 },
  sessionDate: { fontSize: 15, fontWeight: '800' },
  sessionTime: { fontSize: 12, color: '#999', marginTop: 2 },
  sessionQuickStats: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sessionQuickStat: { fontSize: 13, fontWeight: '700' },
  activeSessionBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#EAF8EF', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  activeSessionLabel: { color: '#1DB954', fontSize: 12, fontWeight: '800', marginBottom: 2 },
  activeSessionText: { color: '#2D6A3F', fontSize: 12 },
  activeSessionBtn: { backgroundColor: '#1DB954', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  activeSessionBtnText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  detailsLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  detailsLoadingText: { color: '#999', fontSize: 12 },
  loadMoreBtn: { borderRadius: 16, padding: 14, alignItems: 'center', marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 },
  loadMoreText: { fontSize: 14, fontWeight: '800' },

  // Mini Map
  miniMapCard: { height: 180, marginHorizontal: 14, marginBottom: 12, borderRadius: 14, overflow: 'hidden' },
  miniMap: { width: '100%', height: '100%' },
  miniMapEmpty: { height: 80, marginHorizontal: 14, marginBottom: 12, backgroundColor: '#F0F4F8', borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  miniMapEmptyText: { color: '#999', fontSize: 13 },

  // Stats Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, marginBottom: 12 },
  statCard: { width: (width - 36 - 28 - 16) / 3, borderRadius: 12, padding: 10, alignItems: 'center', gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 13, fontWeight: '800' },
  statLabel: { fontSize: 10, color: '#999', textAlign: 'center' },

  // Sub title
  subTitle: { fontSize: 14, fontWeight: '700', marginLeft: 14, marginBottom: 8 },

  // Photos
  photoScroll: { paddingHorizontal: 14, marginBottom: 14 },
  photoCard: { marginRight: 10, borderRadius: 12, overflow: 'hidden' },
  photoImg: { width: 90, height: 90, borderRadius: 12 },
  photoMeta: { fontSize: 10, color: '#999', marginTop: 3, textAlign: 'center' },

  // Group Banner
  groupBanner: { borderRadius: 20, overflow: 'hidden', marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  groupBannerGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18 },
  groupBannerEmoji: { fontSize: 30 },
  groupBannerTitle: { fontSize: 15, fontWeight: '800', color: '#FFF' },
  groupBannerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  groupBannerRight: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFF', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12 },
  groupBannerBtn: { fontSize: 12, fontWeight: '700', color: '#1DB954' },
});
