import { FontAwesome } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSessions, getLocationsBySession, LocationRecord } from '../../utils/database';
import { calculateElevationGain } from '../../utils/elevation';
import { supabase, SUPABASE_STORAGE_BUCKETS } from '../../utils/supabase';
import { getWeatherFairyResult, WeatherFairyResult } from '../../utils/weatherFairy';

type ProfileStats = {
  sessionCount: number;
  elevationGain: number;
  distanceKm: number;
};

const DEFAULT_PROFILE_STATS: ProfileStats = {
  sessionCount: 0,
  elevationGain: 0,
  distanceKm: 0,
};

const calculateDistanceKm = (locations: LocationRecord[]): number => {
  if (locations.length < 2) return 0;

  const earthRadiusKm = 6371;

  return locations.reduce((acc, current, index) => {
    if (index === 0) return 0;

    const previous = locations[index - 1];
    const dLat = ((current.latitude - previous.latitude) * Math.PI) / 180;
    const dLon = ((current.longitude - previous.longitude) * Math.PI) / 180;
    const previousLat = (previous.latitude * Math.PI) / 180;
    const currentLat = (current.latitude * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(previousLat) * Math.cos(currentLat) * Math.sin(dLon / 2) ** 2;

    return acc + earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, 0);
};

const formatElevation = (meters: number) => `${Math.floor(meters).toLocaleString('ko-KR')}m`;

const formatDistance = (distanceKm: number) => {
  if (distanceKm >= 100) {
    return `${Math.round(distanceKm).toLocaleString('ko-KR')}km`;
  }

  return `${distanceKm.toFixed(1)}km`;
};

const getLevelLabel = (stats: ProfileStats) => {
  if (stats.sessionCount >= 30) return 'Lv.15 전문 덩산객';
  if (stats.sessionCount >= 15) return 'Lv.10 꾸준한 덩산객';
  if (stats.sessionCount >= 5) return 'Lv.5 덩산 루틴러';
  if (stats.sessionCount >= 1) return 'Lv.2 새싹 덩산객';
  return 'Lv.1 첫 덩산 준비 중';
};

export default function ProfileScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const [fairy, setFairy] = useState<WeatherFairyResult | null>(null);
  const [fairyLoading, setFairyLoading] = useState(true);
  const [profileStats, setProfileStats] = useState<ProfileStats>(DEFAULT_PROFILE_STATS);
  const [profileStatsLoading, setProfileStatsLoading] = useState(true);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);

  useEffect(() => {
    if (!user) return;
    getWeatherFairyResult(user.id)
      .then(setFairy)
      .catch(console.warn)
      .finally(() => setFairyLoading(false));
  }, [user]);

  const displayName = user?.user_metadata?.full_name
    ?? user?.user_metadata?.name
    ?? user?.email?.split('@')[0]
    ?? '크루원';

  const avatarUrl = avatarUri
    ?? user?.user_metadata?.avatar_url
    ?? user?.user_metadata?.picture
    ?? `https://i.pravatar.cc/150?u=${user?.id}`;

  const provider = user?.app_metadata?.provider ?? 'email';
  const levelLabel = getLevelLabel(profileStats);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadProfileStats = async () => {
        setProfileStatsLoading(true);

        try {
          const sessions = await getAllSessions();
          const completedSessions = sessions.filter((session) => session.ended_at > 0);
          const sessionDetails = await Promise.all(
            sessions.map(async (session) => {
              const locations = await getLocationsBySession(session.id);
              return { locations };
            }),
          );

          if (!isActive) return;

          const elevationGain = sessionDetails.reduce(
            (sum, detail) => sum + calculateElevationGain(detail.locations),
            0,
          );
          const distanceKm = sessionDetails.reduce(
            (sum, detail) => sum + calculateDistanceKm(detail.locations),
            0,
          );

          setProfileStats({
            sessionCount: completedSessions.length,
            elevationGain,
            distanceKm,
          });
        } catch (error) {
          console.error('[Profile] Failed to load local profile stats:', error);
        } finally {
          if (isActive) setProfileStatsLoading(false);
        }
      };

      loadProfileStats();

      return () => {
        isActive = false;
      };
    }, []),
  );

  const handleSignOut = () => {
    if (isSigningOut) return;

    Alert.alert('로그아웃', '정말 로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          setIsSigningOut(true);
          try {
            const { error } = await signOut();
            if (error) {
              Alert.alert('로그아웃 실패', error.message);
            }
          } finally {
            setIsSigningOut(false);
          }
        },
      },
    ]);
  };

  // 프로필 사진 변경
  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '갤러리 접근 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });

    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setIsUploadingAvatar(true);

    try {
      // 1. Supabase Storage 업로드
      const fileName = `avatars/${user?.id}_${Date.now()}.jpg`;
      const response = await fetch(uri);
      const blob = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_STORAGE_BUCKETS.AVATARS)
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      // 2. Public URL 가져오기
      const { data: urlData } = supabase.storage.from(SUPABASE_STORAGE_BUCKETS.AVATARS).getPublicUrl(fileName);
      const publicUrl = urlData.publicUrl;

      // 3. Supabase 사용자 메타데이터 업데이트
      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl },
      });

      if (updateError) throw updateError;

      // 4. 화면에 즉시 반영
      await refreshUser();
      setAvatarUri(publicUrl);
      Alert.alert('완료', '프로필 사진이 변경되었습니다!');
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '사진 업로드에 실패했습니다.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // 닉네임 저장
  const handleSaveDisplayName = async () => {
    if (!newDisplayName.trim()) {
      Alert.alert('알림', '이름을 입력해주세요.');
      return;
    }
    setIsSavingName(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: newDisplayName.trim() },
      });
      if (error) throw error;
      await refreshUser();
      setEditModalVisible(false);
      Alert.alert('완료', '닉네임이 저장되었습니다!');
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setIsSavingName(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
        <LinearGradient
          colors={['#1DB954', '#0a8a3e']}
          style={styles.headerBackground}
        />

        <View style={styles.profileSection}>
          {/* 아바타 + 편집 오버레이 */}
          <TouchableOpacity style={styles.avatarContainer} onPress={handlePickAvatar} disabled={isUploadingAvatar}>
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
            <View style={styles.avatarEditOverlay}>
              {isUploadingAvatar
                ? <ActivityIndicator size="small" color="#FFF" />
                : <FontAwesome name="camera" size={16} color="#FFF" />
              }
            </View>
            {provider === 'kakao' && (
              <View style={styles.providerBadge}>
                <Text style={styles.providerIcon}>💬</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.level}>{levelLabel}</Text>
          {user?.email && (
            <Text style={styles.email}>{user.email}</Text>
          )}

          <View style={styles.headerButtons}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setNewDisplayName(displayName);
                setEditModalVisible(true);
              }}
            >
              <Text style={styles.editButtonText}>프로필 수정</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.logoutButton, isSigningOut && styles.actionButtonDisabled]}
              onPress={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut
                ? <ActivityIndicator size="small" color="#FF4B4B" />
                : <FontAwesome name="sign-out" size={14} color="#FF4B4B" />
              }
              <Text style={styles.logoutButtonText}>{isSigningOut ? '로그아웃 중' : '로그아웃'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <FontAwesome name="flag-checkered" size={24} color="#FF6B6B" />
            <Text style={styles.statValue}>
              {profileStatsLoading ? '...' : profileStats.sessionCount.toLocaleString('ko-KR')}
            </Text>
            <Text style={styles.statLabel}>총 등반 횟수</Text>
          </View>
          <View style={styles.statBox}>
            <FontAwesome name="arrow-up" size={24} color="#2ECC71" />
            <Text style={styles.statValue}>
              {profileStatsLoading ? '...' : formatElevation(profileStats.elevationGain)}
            </Text>
            <Text style={styles.statLabel}>누적 고도</Text>
          </View>
          <View style={styles.statBox}>
            <FontAwesome name="map-o" size={24} color="#3498DB" />
            <Text style={styles.statValue}>
              {profileStatsLoading ? '...' : formatDistance(profileStats.distanceKm)}
            </Text>
            <Text style={styles.statLabel}>누적 거리</Text>
          </View>
        </View>

        {/* 날씨요정 지수 카드 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>날씨요정 지수 🧚</Text>
          <View style={styles.fairyCard}>
            {fairyLoading ? (
              <ActivityIndicator color="#1DB954" />
            ) : fairy ? (
              <>
                {/* 게이지 */}
                <View style={styles.fairyGaugeRow}>
                  <Text style={styles.fairyEmoji}>{fairy.badgeEmoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.fairyLabelRow}>
                      <Text style={styles.fairyBadgeLabel}>{fairy.badgeLabel}</Text>
                      <Text style={styles.fairyIndexText}>{fairy.index}점</Text>
                    </View>
                    <View style={styles.gaugeTrack}>
                      <View style={[
                        styles.gaugeFill,
                        {
                          width: `${Math.min(100, fairy.index)}%` as any,
                          backgroundColor: fairy.index >= 65 ? '#F1C40F' : fairy.index >= 52 ? '#1DB954' : fairy.index >= 42 ? '#3498DB' : '#95A5A6',
                        }
                      ]} />
                    </View>
                  </View>
                </View>

                <Text style={styles.fairyDesc}>{fairy.description}</Text>

                {/* 통계 요약 */}
                <View style={styles.fairyStats}>
                  <View style={styles.fairyStat}>
                    <Text style={styles.fairyStatValue}>{fairy.mySessionCount}회</Text>
                    <Text style={styles.fairyStatLabel}>내 참석</Text>
                  </View>
                  <View style={styles.fairyStatDivider} />
                  <View style={styles.fairyStat}>
                    <Text style={styles.fairyStatValue}>{fairy.userAvg}점</Text>
                    <Text style={styles.fairyStatLabel}>내 날씨 평균</Text>
                  </View>
                  <View style={styles.fairyStat}>
                    <Text style={styles.fairyStatValue}>{fairy.globalAvg}점</Text>
                    <Text style={styles.fairyStatLabel}>전체 평균</Text>
                  </View>
                </View>
              </>
            ) : (
              <Text style={{ color: '#999', textAlign: 'center' }}>데이터를 불러올 수 없습니다.</Text>
            )}
          </View>
        </View>

        {/* 날씨요정 / 날씨요괴 안내 — 접이기 툴팁 */}
        <TouchableOpacity
          style={styles.infoBox}
          onPress={() => setInfoExpanded((v) => !v)}
          activeOpacity={0.85}
        >
          <View style={styles.infoTitleRow}>
            <Text style={styles.infoTitle}>🧚 날씨요정 &amp; 👺 날씨요괴란?</Text>
            <FontAwesome
              name={infoExpanded ? 'chevron-up' : 'chevron-down'}
              size={13}
              color="#999"
            />
          </View>

          {infoExpanded && (
            <>
              <Text style={styles.infoBody}>
                내가 참석한 덩산의 날씨가 전체 평균보다{' '}
                <Text style={styles.infoHighlight}>더 좋으면 날씨요정</Text>,{' '}
                <Text style={styles.infoWarningText}>더 나쁘면 날씨요괴</Text>가 됩니다.
              </Text>

              {/* 요정 계열 */}
              <Text style={styles.infoSubTitle}>☀️ 날씨요정 계열</Text>
              <View style={styles.infoBadgeList}>
                {[
                  { emoji: '🌱', name: '새싹 날씨요정', cond: '참석일 날씨가 미참석일보다 조금 더 좋으면' },
                  { emoji: '🧚', name: '날씨요정', cond: '차이가 통계적으로 의미있는 수준' },
                  { emoji: '✨', name: '골드 날씨요정', cond: '차이가 매우 명확하게 유의미할 때' },
                ].map((b) => (
                  <View key={b.name} style={styles.infoBadgeRow}>
                    <Text style={styles.infoBadgeEmoji}>{b.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.infoBadgeName}>{b.name}</Text>
                      <Text style={styles.infoBadgeCondition}>{b.cond}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* 요괴 계열 */}
              <Text style={[styles.infoSubTitle, { color: '#C0392B' }]}>🌧️ 날씨요괴 계열</Text>
              <View style={styles.infoBadgeList}>
                {[
                  { emoji: '👺', name: '날씨요괴', cond: '참석일 날씨가 전체 평균보다 유의미하게 나쁘면' },
                  { emoji: '🌩️', name: '대왕 날씨요괴', cond: '구름을 몰고 다닐수록 전설의 요괴로 확정' },
                ].map((b) => (
                  <View key={b.name} style={styles.infoBadgeRow}>
                    <Text style={styles.infoBadgeEmoji}>{b.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.infoBadgeName, { color: '#C0392B' }]}>{b.name}</Text>
                      <Text style={styles.infoBadgeCondition}>{b.cond}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* 요괴 박탈 조건 */}
              <View style={styles.goblinBox}>
                <Text style={styles.goblinBoxTitle}>👺 → 🧚 날씨요괴에서 날씨요정으로 변신할 수 있어요!</Text>
                <Text style={styles.goblinBoxText}>
                  <Text style={styles.goblinBoxBold}>날씨 좋은 날 덩산에 자주 참석</Text>하면 지수가 올라가 요괴에서 요정으로 변신할 수 있어요.{'\n'}
                  반대로 요정 등급이라도 <Text style={styles.goblinBoxBold}>불참 + 날씨가 좋으면</Text> 요괴로 변할 수 있으니 방심금지! ⛰️
                </Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* 닉네임 수정 모달 */}
      <Modal visible={editModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>프로필 수정 ✏️</Text>

            <View style={styles.modalAvatarRow}>
              <Image source={{ uri: avatarUrl }} style={styles.modalAvatar} />
              <TouchableOpacity
                style={[styles.modalAvatarEdit, isUploadingAvatar && styles.actionButtonDisabled]}
                onPress={handlePickAvatar}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <FontAwesome name="camera" size={14} color="#FFF" />
                }
                <Text style={styles.modalAvatarEditText}>{isUploadingAvatar ? '업로드 중' : '사진 변경'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>닉네임</Text>
            <TextInput
              style={styles.modalInput}
              value={newDisplayName}
              onChangeText={setNewDisplayName}
              placeholder="사용할 닉네임을 입력하세요"
              maxLength={20}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#EEE' }]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={{ color: '#333', fontWeight: '700' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#1DB954', flex: 2 }]}
                onPress={handleSaveDisplayName}
                disabled={isSavingName}
              >
                {isSavingName
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Text style={{ color: '#FFF', fontWeight: '800' }}>저장하기</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  headerBackground: {
    height: 200,
    width: '100%',
    position: 'absolute',
    top: 0,
  },
  profileSection: {
    alignItems: 'center',
    marginTop: 110,
    paddingHorizontal: 20,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#FFF',
    backgroundColor: '#E0E0E0',
  },
  avatarEditOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    left: 0,
    top: 0,
    borderRadius: 60,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'transparent',
  },
  providerBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: '#FEE500',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  providerIcon: {
    fontSize: 16,
  },
  name: {
    fontSize: 26,
    fontWeight: '900',
    marginTop: 15,
    color: '#111',
  },
  level: {
    fontSize: 15,
    color: '#666',
    marginTop: 5,
    fontWeight: '600',
  },
  email: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  editButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DDD',
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  editButtonText: {
    fontWeight: '600',
    color: '#555',
    fontSize: 14,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FFD0D0',
    backgroundColor: 'rgba(255,75,75,0.06)',
    gap: 6,
  },
  logoutButtonText: {
    fontWeight: '600',
    color: '#FF4B4B',
    fontSize: 14,
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 30,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    borderRadius: 16,
    marginHorizontal: 5,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
    color: '#111',
  },
  statLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    marginTop: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 20,
    marginBottom: 15,
    color: '#111',
  },
  bottomSpacer: {
    height: 60,
  },
  fairyCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    marginHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    gap: 14,
  },
  fairyGaugeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fairyEmoji: {
    fontSize: 36,
  },
  fairyLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  fairyBadgeLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  fairyIndexText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#1DB954',
  },
  gaugeTrack: {
    height: 10,
    backgroundColor: '#F0F0F0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 5,
  },
  fairyDesc: {
    fontSize: 13,
    color: '#666',
    lineHeight: 20,
    textAlign: 'center',
  },
  fairyStats: {
    flexDirection: 'row',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
  },
  fairyStat: {
    flex: 1,
    alignItems: 'center',
  },
  fairyStatValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111',
  },
  fairyStatLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 3,
  },
  fairyStatDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 4,
  },
  infoBox: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: '#F0F7FF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#D0E8FF',
    gap: 14,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1A5F9E',
    flex: 1,
  },
  infoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  infoBody: {
    fontSize: 13,
    color: '#444',
    lineHeight: 20,
  },
  infoHighlight: {
    color: '#1DB954',
    fontWeight: '700',
  },
  infoBadgeList: {
    gap: 10,
  },
  infoBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoBadgeEmoji: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  infoBadgeName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#222',
  },
  infoBadgeCondition: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
  },
  warningBox: {
    backgroundColor: '#FFF8E7',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FFE0A0',
    gap: 6,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B8620A',
  },
  warningText: {
    fontSize: 13,
    color: '#7A4400',
    lineHeight: 20,
  },
  warningBold: {
    fontWeight: '700',
    color: '#B8620A',
  },
  infoSubTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1A5F9E',
    marginTop: 4,
  },
  infoWarningText: {
    color: '#C0392B',
    fontWeight: '700',
  },
  goblinBox: {
    backgroundColor: '#FDF0F0',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#FBBCBC',
    gap: 6,
  },
  goblinBoxTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#922B21',
  },
  goblinBoxText: {
    fontSize: 13,
    color: '#7B241C',
    lineHeight: 20,
  },
  goblinBoxBold: {
    fontWeight: '700',
    color: '#C0392B',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 24,
    gap: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111',
    textAlign: 'center',
  },
  modalAvatarRow: {
    alignItems: 'center',
    gap: 10,
  },
  modalAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E0E0E0',
  },
  modalAvatarEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1DB954',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    gap: 6,
  },
  modalAvatarEditText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 13,
    fontSize: 16,
    color: '#111',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  modalBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
});
