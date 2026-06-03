import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity,
  FlatList, Modal, TextInput, Alert, ActivityIndicator, Share,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import * as Crypto from 'expo-crypto';
import { Colors } from '../../constants/theme';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { supabase } from '../../utils/supabase';
import { useAuth } from '../../contexts/AuthContext';

// ─── 한글 입력 보완: 컴포넌트 함수 내부에 정의하면 렌더마다 새 타입으로
// 인식되어 IME 조합 중 포커스가 해제됩니다. 반드시 최상위 레벨에 정의해야 합니다.
interface StyledInputProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  isDark?: boolean;
  textColor?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  extraStyle?: object;
}

const StyledInput = React.memo(({ placeholder, value, onChangeText, multiline, isDark, textColor, autoCapitalize, maxLength, extraStyle }: StyledInputProps) => (
  <TextInput
    style={[
      styles.input,
      multiline && { height: 80, textAlignVertical: 'top' },
      { color: textColor ?? '#111', borderColor: isDark ? '#333' : '#EEE', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' },
      extraStyle,
    ]}
    placeholder={placeholder}
    placeholderTextColor={isDark ? '#555' : '#AAA'}
    value={value}
    onChangeText={onChangeText}
    multiline={multiline}
    autoCapitalize={autoCapitalize ?? 'sentences'}
    maxLength={maxLength}
    blurOnSubmit={!multiline}
  />
));
StyledInput.displayName = 'StyledInput';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Group {
  id: string;
  name: string;
  description?: string;
  creator_id: string;
  invite_code: string;
  member_count: number;
  created_at: string;
}

interface GroupHike {
  id: string;
  group_id: string;
  title: string;
  mountain_name: string;
  meeting_at: string;
  meeting_point: string;
  description: string;
  summary_text?: string;
  creator_id: string;
  status: 'planned' | 'completed';
  participants_count: number;
}

interface JoinGroupResult {
  group_id: string;
  group_name: string;
  joined: boolean;
  already_member: boolean;
}

const formatMeetingAt = (iso: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const isDuplicateMembershipError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  return error.code === '23505' || error.message?.toLowerCase().includes('duplicate');
};

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();

  // view: 'groups' = 그룹 목록, 'hikes' = 그룹 산행 기록
  const [view, setView] = useState<'groups' | 'hikes'>('groups');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [hikes, setHikes] = useState<GroupHike[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [createGroupModal, setCreateGroupModal] = useState(false);
  const [joinGroupModal, setJoinGroupModal] = useState(false);
  const [createHikeModal, setCreateHikeModal] = useState(false);

  // Inputs
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [newHike, setNewHike] = useState({
    title: '', mountain_name: '', meeting_at: '', meeting_point: '', description: '',
  });
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [tempDate, setTempDate] = useState<Date | null>(null);

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  const fetchGroups = useCallback(async () => {
    if (!user?.id) {
      setGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: memberRows, error: mErr } = await supabase
        .from('group_members').select('group_id').eq('user_id', user.id);
      if (mErr) throw mErr;

      const ids = memberRows?.map((m) => m.group_id) ?? [];
      if (ids.length === 0) { setGroups([]); return; }

      const { data, error } = await supabase
        .from('groups').select('*, group_members(count)').in('id', ids);
      if (error) throw error;

      setGroups(data.map((g: any) => ({
        ...g, member_count: g.group_members[0]?.count ?? 0,
      })));
    } catch (e: any) {
      console.error('[Groups]', e.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchGroupHikes = async (groupId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('group_hikes')
        .select('*, group_hike_attendance(count)')
        .eq('group_id', groupId)
        .order('meeting_at', { ascending: false }); // 최근 산행부터
      if (error) throw error;

      setHikes(data.map((h: any) => ({
        ...h, participants_count: h.group_hike_attendance[0]?.count ?? 0,
      })));
    } catch (e: any) {
      console.error('[Groups]', e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleSelectGroup = (group: Group) => {
    setSelectedGroup(group);
    setView('hikes');
    fetchGroupHikes(group.id);
  };

  const handleBack = () => {
    setView('groups');
    setSelectedGroup(null);
    setHikes([]);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) { Alert.alert('알림', '그룹 이름을 입력해주세요.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '그룹을 만들려면 로그인이 필요합니다.'); return; }

    try {
      const inviteCode = Crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const { data, error } = await supabase
        .from('groups')
        .insert([{ name: newGroupName.trim(), description: newGroupDesc.trim() || null, creator_id: user.id, invite_code: inviteCode }])
        .select().single();
      if (error) throw error;

      const { error: memberError } = await supabase
        .from('group_members')
        .insert([{ group_id: data.id, user_id: user.id }]);
      if (memberError && !isDuplicateMembershipError(memberError)) throw memberError;

      setCreateGroupModal(false);
      setNewGroupName(''); setNewGroupDesc('');
      fetchGroups();
      Alert.alert('그룹 생성 완료 🎉', `초대 코드: ${inviteCode}\n카카오톡으로 공유해 크루원을 초대하세요!`);
    } catch (e: any) { Alert.alert('오류', e.message); }
  };

  const handleJoinGroup = async () => {
    if (!inviteCodeInput.trim()) { Alert.alert('알림', '초대 코드를 입력해주세요.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '그룹에 참여하려면 로그인이 필요합니다.'); return; }

    try {
      const { data, error } = await supabase.rpc('join_group_by_invite_code', {
        p_invite_code: inviteCodeInput.trim().toUpperCase(),
      });
      if (error) throw error;

      const result = (data?.[0] ?? null) as JoinGroupResult | null;
      if (!result) { Alert.alert('오류', '그룹 참여 결과를 확인할 수 없습니다.'); return; }

      setJoinGroupModal(false); setInviteCodeInput('');
      fetchGroups();
      if (result.already_member) {
        Alert.alert('이미 참여 중', `${result.group_name} 그룹에 이미 참여하고 있습니다.`);
        return;
      }
      Alert.alert('참여 완료 🎉', `${result.group_name} 그룹에 참여했습니다!`);
    } catch (e: any) { Alert.alert('오류', e.message); }
  };

  const handleInviteViaKakao = async (group: Group) => {
    try {
      await Share.share({
        message: `[덩산] ${group.name} 그룹에 초대합니다! 🏔️\n앱에서 초대 코드를 입력해 참여하세요.\n초대 코드: ${group.invite_code}`,
        title: '덩산 그룹 초대',
      });
    } catch (e: any) { console.error(e.message); }
  };

  const handleCreateHike = async () => {
    if (!newHike.title || !newHike.meeting_at) { Alert.alert('알림', '제목과 일시는 필수입니다.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '산행을 등록하려면 로그인이 필요합니다.'); return; }

    try {
      const { data, error } = await supabase
        .from('group_hikes')
        .insert([{ ...newHike, group_id: selectedGroup?.id, creator_id: user.id, status: 'planned' }])
        .select().single();
      if (error) throw error;

      const { error: attendanceError } = await supabase
        .from('group_hike_attendance')
        .insert([{ hike_id: data.id, user_id: user.id }]);
      if (attendanceError && !isDuplicateMembershipError(attendanceError)) throw attendanceError;

      setCreateHikeModal(false);
      setNewHike({ title: '', mountain_name: '', meeting_at: '', meeting_point: '', description: '' });
      if (selectedGroup) fetchGroupHikes(selectedGroup.id);
    } catch (e: any) { Alert.alert('오류', e.message); }
  };

  // ─── Renders ────────────────────────────────────────────────────────────────

  const renderGroupItem = ({ item }: { item: Group }) => (
    <TouchableOpacity
      style={[styles.groupCard, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}
      onPress={() => handleSelectGroup(item)}
      activeOpacity={0.8}
    >
      <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.groupAvatar}>
        <Text style={styles.groupAvatarText}>{item.name.charAt(0)}</Text>
      </LinearGradient>
      <View style={styles.groupInfo}>
        <Text style={[styles.groupName, { color: theme.text }]}>{item.name}</Text>
        {item.description ? <Text style={styles.groupDesc} numberOfLines={1}>{item.description}</Text> : null}
        <Text style={styles.memberCount}>👥 {item.member_count}명</Text>
      </View>
      <View style={styles.groupCardRight}>
        <TouchableOpacity
          style={styles.inviteBtn}
          onPress={(e) => { e.stopPropagation(); handleInviteViaKakao(item); }}
        >
          <Text style={styles.inviteBtnText}>💬 초대</Text>
        </TouchableOpacity>
        <FontAwesome name="chevron-right" size={13} color="#CCC" style={{ marginTop: 10 }} />
      </View>
    </TouchableOpacity>
  );

  const renderHikeItem = ({ item }: { item: GroupHike }) => {
    const date = new Date(item.meeting_at);
    const isCompleted = item.status === 'completed';
    return (
      <View style={[styles.hikeCard, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
        <View style={[styles.hikeBadge, { backgroundColor: isCompleted ? '#E8F5E9' : '#FFF8E1' }]}>
          <Text style={[styles.hikeBadgeText, { color: isCompleted ? '#2E7D32' : '#F9A825' }]}>
            {isCompleted ? '✅ 완료된 산행' : '📅 예정된 산행'}
          </Text>
        </View>

        <Text style={[styles.hikeTitle, { color: theme.text }]}>{item.title}</Text>
        {item.mountain_name ? <Text style={styles.hikeMountain}>⛰️ {item.mountain_name}</Text> : null}

        <View style={styles.hikeMetaCol}>
          <View style={styles.hikeMeta}>
            <FontAwesome name="calendar" size={12} color={theme.tint} />
            <Text style={styles.hikeMetaText}>
              {date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
            </Text>
          </View>
          {item.meeting_point ? (
            <View style={styles.hikeMeta}>
              <FontAwesome name="map-marker" size={12} color={theme.tint} />
              <Text style={styles.hikeMetaText}>{item.meeting_point}</Text>
            </View>
          ) : null}
        </View>

        {isCompleted && item.summary_text ? (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>📝 산행 기록</Text>
            <Text style={[styles.summaryText, { color: theme.text }]}>{item.summary_text}</Text>
          </View>
        ) : null}

        <View style={styles.hikeFooter}>
          <FontAwesome name="users" size={13} color="#999" />
          <Text style={styles.participantsText}>{item.participants_count}명 함께</Text>
        </View>
      </View>
    );
  };

  // ─── View: Hike List ─────────────────────────────────────────────────────────

  if (view === 'hikes' && selectedGroup) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F8F9FA' }]}>
        <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <FontAwesome name="chevron-left" size={16} color="#FFF" />
            <Text style={styles.backBtnText}>그룹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{selectedGroup.name}</Text>
          <Text style={styles.headerSub}>산행 기록 · 최근 순</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setCreateHikeModal(true)}>
            <FontAwesome name="plus" size={13} color="#1DB954" />
            <Text style={styles.addBtnText}>산행 등록</Text>
          </TouchableOpacity>
        </LinearGradient>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={theme.tint} /></View>
        ) : hikes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏔️</Text>
            <Text style={styles.emptyTitle}>아직 산행 기록이 없어요</Text>
            <Text style={styles.emptyDesc}>첫 번째 그룹 산행을 등록해보세요!</Text>
          </View>
        ) : (
          <FlatList
            data={hikes}
            keyExtractor={(item) => item.id}
            renderItem={renderHikeItem}
            contentContainerStyle={styles.listPad}
            onRefresh={() => fetchGroupHikes(selectedGroup.id)}
            refreshing={loading}
          />
        )}

        {/* 산행 등록 모달 */}
        <Modal visible={createHikeModal} animationType="slide" transparent>
          <View style={styles.overlay}>
            <View style={[styles.modalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
              <View style={styles.modalHead}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>새 산행 등록</Text>
                <TouchableOpacity onPress={() => setCreateHikeModal(false)}>
                  <FontAwesome name="times" size={22} color={theme.text} />
                </TouchableOpacity>
              </View>
              <ScrollView>
                <StyledInput placeholder="산행 제목" value={newHike.title} onChangeText={(t: string) => setNewHike({ ...newHike, title: t })} />
                <StyledInput placeholder="산 이름" value={newHike.mountain_name} onChangeText={(t: string) => setNewHike({ ...newHike, mountain_name: t })} />
                <TouchableOpacity
                  style={[styles.input, { borderColor: isDark ? '#333' : '#EEE', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA', justifyContent: 'center' }]}
                  onPress={() => {
                    setPickerMode('date');
                    setDatePickerVisibility(true);
                  }}
                >
                  <Text style={{ color: newHike.meeting_at ? (theme.text as string) : (isDark ? '#555' : '#AAA'), fontSize: 15 }}>
                    {newHike.meeting_at ? formatMeetingAt(newHike.meeting_at) : '일시 선택 (달력 및 시계)'}
                  </Text>
                </TouchableOpacity>
                <DateTimePickerModal
                  isVisible={isDatePickerVisible}
                  mode={pickerMode}
                  display={pickerMode === 'date' ? 'inline' : 'spinner'}
                  minuteInterval={5}
                  onConfirm={(date) => {
                    if (pickerMode === 'date') {
                      setTempDate(date);
                      setPickerMode('time');
                    } else {
                      setDatePickerVisibility(false);
                      const finalDate = tempDate || date;
                      const meetingAt = new Date(finalDate);
                      meetingAt.setHours(date.getHours(), date.getMinutes(), 0, 0);
                      setNewHike({ ...newHike, meeting_at: meetingAt.toISOString() });
                      setTempDate(null);
                    }
                  }}
                  onCancel={() => {
                    setDatePickerVisibility(false);
                    setTempDate(null);
                  }}
                  confirmTextIOS="확인"
                  cancelTextIOS="취소"
                />
                <StyledInput placeholder="집결 장소" value={newHike.meeting_point} onChangeText={(t: string) => setNewHike({ ...newHike, meeting_point: t })} />
                <StyledInput placeholder="상세 설명" multiline value={newHike.description} onChangeText={(t: string) => setNewHike({ ...newHike, description: t })} />
                <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={handleCreateHike}>
                  <Text style={styles.submitBtnText}>등록하기</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ─── View: Group List ────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F8F9FA' }]}>
      <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.header}>
        <Text style={styles.headerTitle}>그룹</Text>
        <Text style={styles.headerSub}>함께 오르는 즐거움 ⛰️</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.addBtn} onPress={() => setJoinGroupModal(true)}>
            <FontAwesome name="sign-in" size={13} color="#1DB954" />
            <Text style={styles.addBtnText}>코드로 참여</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: '#FEE500' }]} onPress={() => setCreateGroupModal(true)}>
            <FontAwesome name="plus" size={13} color="#3B1D1D" />
            <Text style={[styles.addBtnText, { color: '#3B1D1D' }]}>그룹 만들기</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.tint} /></View>
      ) : groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>👥</Text>
          <Text style={styles.emptyTitle}>소속된 그룹이 없어요</Text>
          <Text style={styles.emptyDesc}>새 그룹을 만들거나 초대 코드로 참여해보세요!</Text>
          <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.tint, paddingHorizontal: 30, marginTop: 20 }]} onPress={() => setCreateGroupModal(true)}>
            <Text style={styles.submitBtnText}>그룹 만들기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroupItem}
          contentContainerStyle={styles.listPad}
          onRefresh={fetchGroups}
          refreshing={loading}
        />
      )}

      {/* 그룹 만들기 모달 */}
      <Modal visible={createGroupModal} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>새 그룹 만들기</Text>
              <TouchableOpacity onPress={() => setCreateGroupModal(false)}>
                <FontAwesome name="times" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <StyledInput
              placeholder="그룹 이름 (예: 북한산 크루)"
              value={newGroupName}
              onChangeText={setNewGroupName}
              isDark={isDark}
              textColor={theme.text as string}
            />
            <StyledInput
              placeholder="그룹 소개 (선택사항)"
              multiline
              value={newGroupDesc}
              onChangeText={setNewGroupDesc}
              isDark={isDark}
              textColor={theme.text as string}
            />
            <Text style={styles.hint}>그룹 생성 후 초대 코드를 카카오톡으로 공유하면 크루원들이 참여할 수 있어요.</Text>
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: theme.tint }]} onPress={handleCreateGroup}>
              <Text style={styles.submitBtnText}>만들기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 코드로 참여 모달 */}
      <Modal visible={joinGroupModal} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>그룹 참여하기</Text>
              <TouchableOpacity onPress={() => setJoinGroupModal(false)}>
                <FontAwesome name="times" size={22} color={theme.text} />
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>카카오톡으로 받은 초대 코드를 입력해주세요.</Text>
            <TextInput
              style={[styles.input, styles.codeInput, { color: theme.text, borderColor: isDark ? '#333' : '#EEE', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' }]}
              placeholder="초대 코드 (8자리)"
              placeholderTextColor={isDark ? '#555' : '#AAA'}
              value={inviteCodeInput}
              onChangeText={setInviteCodeInput}
              autoCapitalize="characters"
              maxLength={8}
            />
            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: '#FEE500' }]} onPress={handleJoinGroup}>
              <Text style={[styles.submitBtnText, { color: '#3B1D1D' }]}>💬 참여하기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 55, paddingBottom: 22, paddingHorizontal: 22, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  backBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 3, marginBottom: 14 },
  headerActions: { flexDirection: 'row', gap: 10 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  addBtnText: { color: '#1DB954', fontWeight: '700', fontSize: 13 },
  listPad: { padding: 18, paddingTop: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#333', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },

  // Group Card
  groupCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  groupAvatar: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  groupAvatarText: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 17, fontWeight: '800' },
  groupDesc: { fontSize: 13, color: '#999', marginTop: 2 },
  memberCount: { fontSize: 12, color: '#AAA', marginTop: 4 },
  groupCardRight: { alignItems: 'center', gap: 4, marginLeft: 8 },
  inviteBtn: { backgroundColor: '#FEE500', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  inviteBtnText: { color: '#3B1D1D', fontWeight: '700', fontSize: 12 },

  // Hike Card
  hikeCard: { borderRadius: 20, padding: 18, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  hikeBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginBottom: 10 },
  hikeBadgeText: { fontSize: 12, fontWeight: '700' },
  hikeTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  hikeMountain: { fontSize: 14, color: '#1DB954', fontWeight: '600', marginBottom: 10 },
  hikeMetaCol: { gap: 5, marginBottom: 8 },
  hikeMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hikeMetaText: { fontSize: 13, color: '#666' },
  summaryBox: { backgroundColor: '#F0FAF4', padding: 12, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#1DB954', marginTop: 8 },
  summaryLabel: { fontSize: 12, fontWeight: '700', color: '#1DB954', marginBottom: 4 },
  summaryText: { fontSize: 13, lineHeight: 20 },
  hikeFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  participantsText: { fontSize: 13, color: '#999' },

  // Modals
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalBox: { borderRadius: 25, padding: 24 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 12, fontSize: 15 },
  codeInput: { textAlign: 'center', letterSpacing: 4, fontSize: 20, fontWeight: '800' },
  hint: { fontSize: 12, color: '#999', marginBottom: 14, lineHeight: 18 },
  submitBtn: { padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 4 },
  submitBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
