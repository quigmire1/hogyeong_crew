import { FontAwesome } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase, SUPABASE_STORAGE_BUCKETS } from '../../utils/supabase';
import { getWeatherFairyResult, WeatherFairyResult } from '../../utils/weatherFairy';

export default function ProfileScreen() {
  const { user, signOut, refreshUser } = useAuth();
  const [fairy, setFairy] = useState<WeatherFairyResult | null>(null);
  const [fairyLoading, setFairyLoading] = useState(true);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
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

  const handleSignOut = () => {
    Alert.alert('로그아웃', '정말 로그아웃 하시겠어요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: async () => {
          const { error } = await signOut();
          if (error) {
            Alert.alert('로그아웃 실패', error.message);
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
          <Text style={styles.level}>Lv.15 전문 등산객</Text>
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
            <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
              <FontAwesome name="sign-out" size={14} color="#FF4B4B" />
              <Text style={styles.logoutButtonText}>로그아웃</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <FontAwesome name="flag-checkered" size={24} color="#FF6B6B" />
            <Text style={styles.statValue}>32</Text>
            <Text style={styles.statLabel}>총 등반 횟수</Text>
          </View>
          <View style={styles.statBox}>
            <FontAwesome name="arrow-up" size={24} color="#2ECC71" />
            <Text style={styles.statValue}>12,500m</Text>
            <Text style={styles.statLabel}>누적 고도</Text>
          </View>
          <View style={styles.statBox}>
            <FontAwesome name="map-o" size={24} color="#3498DB" />
            <Text style={styles.statValue}>145km</Text>
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
                내가 참석한 산행의 날씨가 전체 평균보다{' '}
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
                  <Text style={styles.goblinBoxBold}>날씨 좋은 날 산행에 자주 참석</Text>하면 지수가 올라가 요괴에서 요정으로 변신할 수 있어요.{'\n'}
                  반대로 요정 등급이라도 <Text style={styles.goblinBoxBold}>불참 + 날씨가 좋으면</Text> 요괴로 변할 수 있으니 방심금지! ⛰️
                </Text>
              </View>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>나의 배지 🏆</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgeScroll}>
            {/* 날씨요정 뱃지 (동적) */}
            {fairy?.badge && (
              <View style={styles.badgeItem}>
                <View style={[styles.badgeCircle, {
                  backgroundColor:
                    fairy.badge === 'goblin_boss' ? '#F8D7DA' :
                      fairy.badge === 'goblin' ? '#FDE8D8' :
                        fairy.badge === 'gold' ? '#FFF3CD' :
                          '#E8F8EE',
                }]}>
                  <Text style={{ fontSize: 28 }}>{fairy.badgeEmoji}</Text>
                </View>
                <Text style={styles.badgeName}>{fairy.badgeLabel}</Text>
              </View>
            )}
            {['북한산 정복', '관악산 완등', '도봉산 마스터', '설악산 도전', '한라산 등정'].map((name, i) => (
              <View key={i} style={styles.badgeItem}>
                <View style={styles.badgeCircle}>
                  <FontAwesome name="trophy" size={28} color="#F1C40F" />
                </View>
                <Text style={styles.badgeName}>{name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={[styles.section, { paddingBottom: 60 }]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>최근 사진 📸</Text>
            <TouchableOpacity>
              <Text style={styles.seeAllText}>전체보기</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.photoGrid}>
            {[
              'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400',
              'https://images.unsplash.com/photo-1519904981063-b0cf448d479e?w=400',
              'https://images.unsplash.com/photo-1605206675545-e6552a926d52?w=400',
            ].map((uri, index) => (
              <Image key={index} source={{ uri }} style={styles.gridImage} />
            ))}
          </View>
        </View>
      </ScrollView>

      {/* 닉네임 수정 모달 */}
      <Modal visible={editModalVisible} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>프로필 수정 ✏️</Text>

            <View style={styles.modalAvatarRow}>
              <Image source={{ uri: avatarUrl }} style={styles.modalAvatar} />
              <TouchableOpacity style={styles.modalAvatarEdit} onPress={handlePickAvatar}>
                <FontAwesome name="camera" size={14} color="#FFF" />
                <Text style={styles.modalAvatarEditText}>사진 변경</Text>
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 20,
    marginBottom: 15,
    color: '#111',
  },
  seeAllText: {
    color: '#1DB954',
    fontWeight: '600',
  },
  badgeScroll: {
    paddingLeft: 20,
  },
  badgeItem: {
    alignItems: 'center',
    padding: 15,
    borderRadius: 16,
    marginRight: 15,
    width: 110,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  badgeCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF9E6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  badgeName: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    color: '#333',
  },
  photoGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  gridImage: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 12,
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
