import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity,
  FlatList, Modal, TextInput, Alert, ActivityIndicator, Share, Image,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { useRouter } from 'expo-router';
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
  mountain_name: string;
  meeting_at: string;
  start_time?: string | null;
  meeting_point: string;
  summary_text?: string;
  creator_id: string;
  status: GroupHikeStatus | 'planned' | 'completed';
  completed_member_count?: number | null;
  completed_at?: string | null;
  participants_count: number;
  is_attending: boolean;
  my_participation_status: GroupHikeParticipationStatus;
  my_local_session_id?: string | null;
}

type GroupHikeStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
type GroupHikeParticipationStatus = 'NOT_STARTED' | 'RECORDING' | 'FINISHED';

interface JoinGroupResult {
  group_id: string;
  group_name: string;
  joined: boolean;
  already_member: boolean;
}

interface HikeParticipant {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

const formatMeetingDate = (iso: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
};

const formatMeetingTime = (iso: string) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const GROUP_HIKE_STATUS_META: Record<GroupHikeStatus, { label: string; badge: string; color: string; background: string }> = {
  SCHEDULED: { label: '예정된 덩산', badge: '📅', color: '#F9A825', background: '#FFF8E1' },
  IN_PROGRESS: { label: '진행중인 덩산', badge: '🥾', color: '#1DB954', background: '#E8F8EE' },
  COMPLETED: { label: '완료된 덩산', badge: '✅', color: '#2E7D32', background: '#E8F5E9' },
  CANCELLED: { label: '취소된 덩산', badge: '⛔', color: '#C62828', background: '#FFEBEE' },
  EXPIRED: { label: '만료된 덩산', badge: '⌛', color: '#6B7280', background: '#F2F4F6' },
};

const normalizeGroupHikeStatus = (status: GroupHike['status']): GroupHikeStatus => {
  if (status === 'planned') return 'SCHEDULED';
  if (status === 'completed') return 'COMPLETED';
  return status;
};

const isTerminalGroupHikeStatus = (status: GroupHikeStatus) => (
  status === 'COMPLETED' || status === 'CANCELLED' || status === 'EXPIRED'
);

const formatGroupHikeName = (hike: Pick<GroupHike, 'mountain_name' | 'meeting_at' | 'start_time'>) => {
  const startTime = hike.start_time ?? hike.meeting_at;
  const month = startTime ? new Date(startTime).getMonth() + 1 : new Date().getMonth() + 1;
  return `${month}월 ${hike.mountain_name || '덩산'}`;
};

const isDuplicateMembershipError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  return error.code === '23505' || error.message?.toLowerCase().includes('duplicate');
};

const isMissingTableError = (error: { code?: string; message?: string } | null | undefined) => {
  if (!error) return false;
  return error.code === 'PGRST205' || error.message?.toLowerCase().includes('could not find the table');
};

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function GroupsScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { user } = useAuth();
  const router = useRouter();

  // view: 'groups' = 그룹 목록, 'hikes' = 그룹 덩산 기록
  const [view, setView] = useState<'groups' | 'hikes'>('groups');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [hikes, setHikes] = useState<GroupHike[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [createGroupModal, setCreateGroupModal] = useState(false);
  const [joinGroupModal, setJoinGroupModal] = useState(false);
  const [createHikeModal, setCreateHikeModal] = useState(false);
  const [editHikeModal, setEditHikeModal] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isJoiningGroup, setIsJoiningGroup] = useState(false);
  const [isCreatingHike, setIsCreatingHike] = useState(false);
  const [isUpdatingHike, setIsUpdatingHike] = useState(false);
  const [attendanceActionHikeId, setAttendanceActionHikeId] = useState<string | null>(null);
  const [deletingHikeId, setDeletingHikeId] = useState<string | null>(null);
  const [editingHike, setEditingHike] = useState<GroupHike | null>(null);
  const [participantModalVisible, setParticipantModalVisible] = useState(false);
  const [participantModalHeading, setParticipantModalHeading] = useState('');
  const [participantModalTitle, setParticipantModalTitle] = useState('');
  const [participantMembers, setParticipantMembers] = useState<HikeParticipant[]>([]);
  const [participantLoading, setParticipantLoading] = useState(false);

  // Inputs
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [newHike, setNewHike] = useState({
    mountain_name: '', meeting_at: '', meeting_point: '',
  });
  const [editHike, setEditHike] = useState({
    mountain_name: '', meeting_at: '', meeting_point: '',
  });
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState<'create' | 'edit'>('create');
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  const currentUserDisplayName = user?.user_metadata?.full_name
    ?? user?.user_metadata?.name
    ?? user?.email?.split('@')[0]
    ?? '크루원';

  const currentUserAvatarUrl = user?.user_metadata?.avatar_url
    ?? user?.user_metadata?.picture
    ?? null;

  const getDatePickerBaseDate = (target: 'create' | 'edit') => {
    const rawDate = target === 'edit' ? editHike.meeting_at : newHike.meeting_at;
    const parsedDate = rawDate ? new Date(rawDate) : new Date();
    return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  };

  const openHikeDatePicker = (target: 'create' | 'edit', mode: 'date' | 'time') => {
    setDatePickerTarget(target);
    setPickerMode(mode);
    setDatePickerVisibility(true);
  };

  const closeHikeDatePicker = () => {
    setDatePickerVisibility(false);
  };

  const setHikeMeetingAt = (target: 'create' | 'edit', meetingAt: Date) => {
    if (target === 'edit') {
      setEditHike((prev) => ({ ...prev, meeting_at: meetingAt.toISOString() }));
    } else {
      setNewHike((prev) => ({ ...prev, meeting_at: meetingAt.toISOString() }));
    }
  };

  const handleConfirmHikeDate = (target: 'create' | 'edit', mode: 'date' | 'time', date: Date) => {
    setDatePickerVisibility(false);
    const meetingAt = getDatePickerBaseDate(target);

    if (mode === 'date') {
      meetingAt.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    } else {
      meetingAt.setHours(date.getHours(), date.getMinutes(), 0, 0);
    }

    setHikeMeetingAt(target, meetingAt);
  };

  const renderHikeDatePicker = (target: 'create' | 'edit') => (
    <DateTimePickerModal
      isVisible={isDatePickerVisible && datePickerTarget === target}
      mode={pickerMode}
      date={getDatePickerBaseDate(target)}
      display={pickerMode === 'date' ? 'inline' : 'spinner'}
      minuteInterval={5}
      onConfirm={(date) => handleConfirmHikeDate(target, pickerMode, date)}
      onCancel={closeHikeDatePicker}
      confirmTextIOS="확인"
      cancelTextIOS="취소"
    />
  );

  const renderHikeDateTimeButtons = (target: 'create' | 'edit', meetingAt: string) => {
    const placeholderColor = isDark ? '#555' : '#AAA';
    const valueColor = theme.text as string;

    return (
      <View style={styles.dateTimeRow}>
        <TouchableOpacity
          style={[
            styles.dateTimeButton,
            { borderColor: isDark ? '#333' : '#EEE', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' },
          ]}
          onPress={() => openHikeDatePicker(target, 'date')}
        >
          <FontAwesome name="calendar" size={14} color={meetingAt ? theme.tint : placeholderColor} />
          <Text
            style={[styles.dateTimeButtonText, { color: meetingAt ? valueColor : placeholderColor }]}
            numberOfLines={1}
          >
            {meetingAt ? formatMeetingDate(meetingAt) : '날짜 선택'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.dateTimeButton,
            { borderColor: isDark ? '#333' : '#EEE', backgroundColor: isDark ? '#2A2A2A' : '#FAFAFA' },
          ]}
          onPress={() => openHikeDatePicker(target, 'time')}
        >
          <FontAwesome name="clock-o" size={14} color={meetingAt ? theme.tint : placeholderColor} />
          <Text
            style={[styles.dateTimeButtonText, { color: meetingAt ? valueColor : placeholderColor }]}
            numberOfLines={1}
          >
            {meetingAt ? formatMeetingTime(meetingAt) : '시간 선택'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

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
      const { error: refreshError } = await supabase.rpc('refresh_group_hike_statuses', {
        p_group_id: groupId,
      });
      if (refreshError) {
        console.warn('[Groups] Failed to refresh group hike statuses:', refreshError.message);
      }

      const { data, error } = await supabase
        .from('group_hikes')
        .select('*, group_hike_attendance(count)')
        .eq('group_id', groupId)
        .order('start_time', { ascending: false, nullsFirst: false })
        .order('meeting_at', { ascending: false }); // 최근 덩산부터
      if (error) throw error;

      const hikeIds = data?.map((h: any) => h.id) ?? [];
      const { data: myAttendanceRows, error: attendanceError } = user?.id && hikeIds.length > 0
        ? await supabase
          .from('group_hike_attendance')
          .select('hike_id, participation_status, local_session_id')
          .eq('user_id', user.id)
          .in('hike_id', hikeIds)
        : { data: [], error: null };
      if (attendanceError) throw attendanceError;

      const myAttendanceMap = new Map(
        (myAttendanceRows ?? []).map((row: any) => [row.hike_id, row]),
      );
      setHikes((data ?? []).map((h: any) => ({
        ...h, participants_count: h.group_hike_attendance[0]?.count ?? 0,
        status: normalizeGroupHikeStatus(h.status),
        meeting_at: h.start_time ?? h.meeting_at,
        is_attending: myAttendanceMap.has(h.id),
        my_participation_status: myAttendanceMap.get(h.id)?.participation_status ?? 'NOT_STARTED',
        my_local_session_id: myAttendanceMap.get(h.id)?.local_session_id ?? null,
      })));
    } catch (e: any) {
      console.error('[Groups]', e.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedGroupHikes = () => {
    if (selectedGroup) fetchGroupHikes(selectedGroup.id);
  };

  const resolveMembersFromUserIds = async (userIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    const profileMap = new Map<string, { display_name?: string; avatar_url?: string }>();

    if (uniqueUserIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', uniqueUserIds);

      if (profileError && !isMissingTableError(profileError)) {
        console.warn('[Groups] Failed to load member profiles:', profileError.message);
      }

      (profileRows ?? []).forEach((profile: any) => {
        profileMap.set(profile.id, {
          display_name: profile.full_name,
          avatar_url: profile.avatar_url,
        });
      });
    }

    return uniqueUserIds.map((userId) => {
      const profile = profileMap.get(userId);
      const isMe = userId === user?.id;

      return {
        user_id: userId,
        display_name: profile?.display_name
          ?? (isMe ? currentUserDisplayName : '크루원'),
        avatar_url: profile?.avatar_url
          ?? (isMe ? currentUserAvatarUrl : null),
      };
    });
  };

  const handleOpenParticipants = async (hike: GroupHike) => {
    setParticipantModalHeading('참석 멤버');
    setParticipantModalTitle(formatGroupHikeName(hike));
    setParticipantMembers([]);
    setParticipantModalVisible(true);
    setParticipantLoading(true);

    try {
      const { data: attendanceRows, error } = await supabase
        .from('group_hike_attendance')
        .select('user_id, created_at')
        .eq('hike_id', hike.id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const userIds = (attendanceRows ?? []).map((row: any) => row.user_id).filter(Boolean);
      setParticipantMembers(await resolveMembersFromUserIds(userIds));
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '참석자 목록을 불러오지 못했습니다.');
      setParticipantModalVisible(false);
    } finally {
      setParticipantLoading(false);
    }
  };

  const handleOpenGroupMembers = async (group: Group) => {
    setParticipantModalHeading('그룹 멤버');
    setParticipantModalTitle(group.name);
    setParticipantMembers([]);
    setParticipantModalVisible(true);
    setParticipantLoading(true);

    try {
      const { data: memberRows, error } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', group.id);
      if (error) throw error;

      const userIds = (memberRows ?? []).map((row: any) => row.user_id).filter(Boolean);
      setParticipantMembers(await resolveMembersFromUserIds(userIds));
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '그룹 멤버 목록을 불러오지 못했습니다.');
      setParticipantModalVisible(false);
    } finally {
      setParticipantLoading(false);
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
    if (isCreatingGroup) return;
    if (!newGroupName.trim()) { Alert.alert('알림', '그룹 이름을 입력해주세요.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '그룹을 만들려면 로그인이 필요합니다.'); return; }

    setIsCreatingGroup(true);
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
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleJoinGroup = async () => {
    if (isJoiningGroup) return;
    if (!inviteCodeInput.trim()) { Alert.alert('알림', '초대 코드를 입력해주세요.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '그룹에 참여하려면 로그인이 필요합니다.'); return; }

    setIsJoiningGroup(true);
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
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setIsJoiningGroup(false);
    }
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
    if (isCreatingHike) return;
    if (!newHike.mountain_name || !newHike.meeting_at) { Alert.alert('알림', '산 이름과 일시는 필수입니다.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '덩산을 등록하려면 로그인이 필요합니다.'); return; }

    setIsCreatingHike(true);
    try {
      const { data, error } = await supabase
        .from('group_hikes')
        .insert([{
          ...newHike,
          start_time: newHike.meeting_at,
          group_id: selectedGroup?.id,
          creator_id: user.id,
          status: 'SCHEDULED',
        }])
        .select().single();
      if (error) throw error;

      const { error: attendanceError } = await supabase
        .from('group_hike_attendance')
        .insert([{ hike_id: data.id, user_id: user.id }]);
      if (attendanceError && !isDuplicateMembershipError(attendanceError)) throw attendanceError;

      setCreateHikeModal(false);
      setNewHike({ mountain_name: '', meeting_at: '', meeting_point: '' });
      if (selectedGroup) fetchGroupHikes(selectedGroup.id);
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setIsCreatingHike(false);
    }
  };

  const handleOpenEditHike = (hike: GroupHike) => {
    if (hike.creator_id !== user?.id) {
      Alert.alert('수정 불가', '덩산 생성자만 일정을 수정할 수 있습니다.');
      return;
    }

    setEditingHike(hike);
    setEditHike({
      mountain_name: hike.mountain_name ?? '',
      meeting_at: hike.meeting_at ?? '',
      meeting_point: hike.meeting_point ?? '',
    });
    setEditHikeModal(true);
  };

  const handleUpdateHike = async () => {
    if (isUpdatingHike || !editingHike) return;
    if (!editHike.mountain_name || !editHike.meeting_at) { Alert.alert('알림', '산 이름과 일시는 필수입니다.'); return; }
    if (!user?.id) { Alert.alert('로그인 필요', '덩산을 수정하려면 로그인이 필요합니다.'); return; }

    setIsUpdatingHike(true);
    try {
      const { error } = await supabase
        .from('group_hikes')
        .update({
          mountain_name: editHike.mountain_name.trim() || null,
          meeting_at: editHike.meeting_at,
          start_time: editHike.meeting_at,
          meeting_point: editHike.meeting_point.trim() || null,
        })
        .eq('id', editingHike.id)
        .eq('creator_id', user.id)
        .select('id')
        .single();
      if (error) throw error;

      const { error: recomputeError } = await supabase.rpc('recompute_group_hike_status', {
        p_hike_id: editingHike.id,
      });
      if (recomputeError) {
        console.warn('[Groups] Failed to recompute group hike status:', recomputeError.message);
      }

      setEditHikeModal(false);
      setEditingHike(null);
      setEditHike({ mountain_name: '', meeting_at: '', meeting_point: '' });
      refreshSelectedGroupHikes();
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setIsUpdatingHike(false);
    }
  };

  const handleAttendHike = async (hike: GroupHike) => {
    if (attendanceActionHikeId || !user?.id) return;

    setAttendanceActionHikeId(hike.id);
    try {
      const { error } = await supabase
        .from('group_hike_attendance')
        .insert([{ hike_id: hike.id, user_id: user.id }]);
      if (error && !isDuplicateMembershipError(error)) throw error;
      refreshSelectedGroupHikes();
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setAttendanceActionHikeId(null);
    }
  };

  const handleCancelAttendance = async (hike: GroupHike) => {
    if (attendanceActionHikeId || !user?.id) return;

    setAttendanceActionHikeId(hike.id);
    try {
      const { error } = await supabase
        .from('group_hike_attendance')
        .delete()
        .eq('hike_id', hike.id)
        .eq('user_id', user.id);
      if (error) throw error;
      refreshSelectedGroupHikes();
    } catch (e: any) {
      Alert.alert('오류', e.message);
    } finally {
      setAttendanceActionHikeId(null);
    }
  };

  const handleStartGroupHike = (hike: GroupHike) => {
    const status = normalizeGroupHikeStatus(hike.status);
    if (status !== 'IN_PROGRESS') {
      Alert.alert('시작 불가', '진행중인 덩산일 때만 덩산을 시작할 수 있습니다.');
      return;
    }

    router.push({
      pathname: '/(tabs)/tracker',
      params: {
        groupHikeId: hike.id,
        groupHikeTitle: formatGroupHikeName(hike),
      },
    });
  };

  const handleOpenGroupHikeRecords = (hike: GroupHike) => {
    router.push({
      pathname: '/records',
      params: {
        groupHikeId: hike.id,
        groupHikeTitle: formatGroupHikeName(hike),
      },
    });
  };

  const handleManualCompleteHike = (hike: GroupHike) => {
    if (!user?.id) return;

    Alert.alert(
      '덩산 수동 완료',
      '완료 기준 인원에 도달하지 않았지만 이 그룹 덩산을 완료 처리할까요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '완료 처리',
          onPress: async () => {
            try {
              const { error } = await supabase.rpc('manual_complete_group_hike', {
                p_hike_id: hike.id,
              });
              if (error) throw error;
              refreshSelectedGroupHikes();
            } catch (e: any) {
              Alert.alert('오류', e.message);
            }
          },
        },
      ],
    );
  };

  const handleCancelHike = (hike: GroupHike) => {
    if (!user?.id) return;

    Alert.alert(
      '덩산 취소',
      '이 덩산을 취소하면 이후 자동 상태 변경 대상에서 제외됩니다. 계속할까요?',
      [
        { text: '닫기', style: 'cancel' },
        {
          text: '취소 처리',
          style: 'destructive',
          onPress: async () => {
            setDeletingHikeId(hike.id);
            try {
              const { error } = await supabase.rpc('cancel_group_hike', {
                p_hike_id: hike.id,
              });
              if (error) throw error;
              refreshSelectedGroupHikes();
            } catch (e: any) {
              Alert.alert('오류', e.message);
            } finally {
              setDeletingHikeId(null);
            }
          },
        },
      ],
    );
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
    const status = normalizeGroupHikeStatus(item.status);
    const statusMeta = GROUP_HIKE_STATUS_META[status];
    const startTime = item.start_time ?? item.meeting_at;
    const date = new Date(startTime);
    const isCompleted = status === 'COMPLETED';
    const isTerminal = isTerminalGroupHikeStatus(status);
    const canStartGroupHike = status === 'IN_PROGRESS';
    const isCreator = item.creator_id === user?.id;
    const isAttendanceLoading = attendanceActionHikeId === item.id;
    const isDeleting = deletingHikeId === item.id;

    return (
      <View style={[styles.hikeCard, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
        <View style={styles.hikeTopRow}>
          <View style={[styles.hikeBadge, { backgroundColor: statusMeta.background }]}>
            <Text style={[styles.hikeBadgeText, { color: statusMeta.color }]}>
              {statusMeta.badge} {statusMeta.label}
            </Text>
          </View>
          <View style={[styles.attendanceBadge, { backgroundColor: item.is_attending ? '#E8F8EE' : '#F2F4F6' }]}>
            <Text style={[styles.attendanceBadgeText, { color: item.is_attending ? '#1DB954' : '#8A949E' }]}>
              {item.my_participation_status === 'FINISHED'
                ? '기록 완료'
                : item.my_participation_status === 'RECORDING'
                  ? '기록 중'
                  : item.is_attending ? '참석' : '미참석'}
            </Text>
          </View>
        </View>

        <Text style={styles.hikeMountainTitle}>⛰️ {formatGroupHikeName(item)}</Text>

        <View style={styles.hikeMetaCol}>
          <View style={styles.hikeMeta}>
            <FontAwesome name="calendar" size={12} color={theme.tint} />
            <Text style={styles.hikeMetaText}>
              {date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
              {' '}
              {date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {typeof item.completed_member_count === 'number' && item.completed_member_count > 0 ? (
            <View style={styles.hikeMeta}>
              <FontAwesome name="check-circle" size={12} color={theme.tint} />
              <Text style={styles.hikeMetaText}>완료 {item.completed_member_count}명</Text>
            </View>
          ) : null}
          {item.meeting_point ? (
            <View style={styles.hikeMeta}>
              <FontAwesome name="map-marker" size={12} color={theme.tint} />
              <Text style={styles.hikeMetaText}>{item.meeting_point}</Text>
            </View>
          ) : null}
        </View>

        {isCompleted && item.summary_text ? (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>📝 덩산 기록</Text>
            <Text style={[styles.summaryText, { color: theme.text }]}>{item.summary_text}</Text>
          </View>
        ) : null}

        <View style={styles.hikeFooter}>
          <TouchableOpacity
            style={styles.participantsRow}
            onPress={() => handleOpenParticipants(item)}
            activeOpacity={0.7}
          >
            <FontAwesome name="users" size={13} color="#999" />
            <Text style={styles.participantsText}>{item.participants_count}명 함께</Text>
            <FontAwesome name="chevron-right" size={10} color="#BBB" />
          </TouchableOpacity>
          <View style={styles.hikeActionRow}>
            {isCreator && !isTerminal && (
              <>
                <TouchableOpacity
                  style={[styles.hikeActionButton, styles.editHikeButton]}
                  onPress={() => handleOpenEditHike(item)}
                  disabled={isDeleting || isUpdatingHike || Boolean(attendanceActionHikeId)}
                >
                  <FontAwesome name="pencil" size={13} color="#1DB954" />
                  <Text style={styles.editHikeButtonText}>수정</Text>
                </TouchableOpacity>
                {status === 'IN_PROGRESS' ? (
                  <TouchableOpacity
                    style={[styles.hikeActionButton, styles.manualCompleteButton]}
                    onPress={() => handleManualCompleteHike(item)}
                    disabled={isDeleting || isUpdatingHike || Boolean(attendanceActionHikeId)}
                  >
                    <FontAwesome name="check-circle" size={13} color="#2E7D32" />
                    <Text style={styles.manualCompleteButtonText}>완료 처리</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.hikeActionButton, styles.deleteHikeButton, isDeleting && styles.submitBtnDisabled]}
                  onPress={() => handleCancelHike(item)}
                  disabled={isDeleting || isUpdatingHike || Boolean(attendanceActionHikeId)}
                >
                  {isDeleting
                    ? <ActivityIndicator size="small" color="#FF4B4B" />
                    : <>
                      <FontAwesome name="ban" size={13} color="#FF4B4B" />
                      <Text style={styles.deleteHikeButtonText}>취소</Text>
                    </>
                  }
                </TouchableOpacity>
              </>
            )}
            {isCompleted ? (
              <TouchableOpacity
                style={[styles.hikeActionButton, styles.recordHikeButton]}
                onPress={() => handleOpenGroupHikeRecords(item)}
              >
                <FontAwesome name="map" size={13} color="#FFF" />
                <Text style={styles.recordHikeButtonText}>덩산 기록</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.hikeActionButton,
                  styles.groupStartButton,
                  !canStartGroupHike && styles.groupStartButtonDisabled,
                ]}
                onPress={() => handleStartGroupHike(item)}
                disabled={!canStartGroupHike || isAttendanceLoading || Boolean(deletingHikeId)}
              >
                <FontAwesome name="play" size={13} color="#FFF" />
                <Text style={styles.groupStartButtonText}>덩산 시작</Text>
              </TouchableOpacity>
            )}
          </View>
          {!isTerminal && (
            <View style={styles.hikeActionRow}>
              <TouchableOpacity
                style={[
                  styles.hikeActionButton,
                  item.is_attending ? styles.cancelAttendanceButton : styles.attendButton,
                  isAttendanceLoading && styles.submitBtnDisabled,
                ]}
                onPress={() => item.is_attending ? handleCancelAttendance(item) : handleAttendHike(item)}
                disabled={isAttendanceLoading || Boolean(deletingHikeId)}
              >
                {isAttendanceLoading
                  ? <ActivityIndicator size="small" color={item.is_attending ? '#666' : '#FFF'} />
                  : <>
                    <FontAwesome name={item.is_attending ? 'times' : 'check'} size={13} color={item.is_attending ? '#666' : '#FFF'} />
                    <Text style={item.is_attending ? styles.cancelAttendanceButtonText : styles.attendButtonText}>
                      {item.is_attending ? '참석 취소' : '참석'}
                    </Text>
                  </>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  // ─── View: Hike List ─────────────────────────────────────────────────────────

  if (view === 'hikes' && selectedGroup) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#F8F9FA' }]}>
        <LinearGradient colors={['#1DB954', '#0a8a3e']} style={styles.header}>
          <View style={styles.hikeHeaderTopRow}>
            <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
              <FontAwesome name="chevron-left" size={16} color="#FFF" />
              <Text style={styles.backBtnText}>그룹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.groupMemberPill}
              onPress={() => handleOpenGroupMembers(selectedGroup)}
              activeOpacity={0.75}
            >
              <FontAwesome name="users" size={12} color="#1DB954" />
              <Text style={styles.groupMemberPillText}>{selectedGroup.member_count}명</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>{selectedGroup.name}</Text>
          <Text style={styles.headerSub}>덩산 기록 · 최근 순</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setCreateHikeModal(true)}>
            <FontAwesome name="plus" size={13} color="#1DB954" />
            <Text style={styles.addBtnText}>덩산 등록</Text>
          </TouchableOpacity>
        </LinearGradient>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={theme.tint} /></View>
        ) : hikes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🏔️</Text>
            <Text style={styles.emptyTitle}>아직 덩산 기록이 없어요</Text>
            <Text style={styles.emptyDesc}>첫 번째 그룹 덩산을 등록해보세요!</Text>
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

        {/* 덩산 등록 모달 */}
        <Modal visible={createHikeModal} animationType="slide" transparent>
          <View style={styles.overlay}>
            <View style={[styles.modalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
              <View style={styles.modalHead}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>새 덩산 등록</Text>
                <TouchableOpacity onPress={() => setCreateHikeModal(false)} disabled={isCreatingHike}>
                  <FontAwesome name="times" size={22} color={theme.text} />
                </TouchableOpacity>
              </View>
              <ScrollView>
                <StyledInput placeholder="산 이름" value={newHike.mountain_name} onChangeText={(t: string) => setNewHike({ ...newHike, mountain_name: t })} />
                {renderHikeDateTimeButtons('create', newHike.meeting_at)}
                <StyledInput placeholder="집결 장소" value={newHike.meeting_point} onChangeText={(t: string) => setNewHike({ ...newHike, meeting_point: t })} />
                {renderHikeDatePicker('create')}
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: theme.tint }, isCreatingHike && styles.submitBtnDisabled]}
                  onPress={handleCreateHike}
                  disabled={isCreatingHike}
                >
                  {isCreatingHike
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.submitBtnText}>등록하기</Text>
                  }
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* 덩산 수정 모달 */}
        <Modal visible={editHikeModal} animationType="slide" transparent>
          <View style={styles.overlay}>
            <View style={[styles.modalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
              <View style={styles.modalHead}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>덩산 일정 수정</Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditHikeModal(false);
                    setEditingHike(null);
                  }}
                  disabled={isUpdatingHike}
                >
                  <FontAwesome name="times" size={22} color={theme.text} />
                </TouchableOpacity>
              </View>
              <ScrollView>
                <StyledInput placeholder="산 이름" value={editHike.mountain_name} onChangeText={(t: string) => setEditHike({ ...editHike, mountain_name: t })} />
                {renderHikeDateTimeButtons('edit', editHike.meeting_at)}
                <StyledInput placeholder="집결 장소" value={editHike.meeting_point} onChangeText={(t: string) => setEditHike({ ...editHike, meeting_point: t })} />
                {renderHikeDatePicker('edit')}
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: theme.tint }, isUpdatingHike && styles.submitBtnDisabled]}
                  onPress={handleUpdateHike}
                  disabled={isUpdatingHike}
                >
                  {isUpdatingHike
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.submitBtnText}>수정하기</Text>
                  }
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* 참석자 목록 모달 */}
        <Modal visible={participantModalVisible} animationType="fade" transparent>
          <View style={styles.overlay}>
            <View style={[styles.participantModalBox, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
              <View style={styles.modalHead}>
                <View style={styles.participantTitleBox}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>{participantModalHeading}</Text>
                  <Text style={styles.participantSubtitle} numberOfLines={1}>{participantModalTitle}</Text>
                </View>
                <TouchableOpacity onPress={() => setParticipantModalVisible(false)}>
                  <FontAwesome name="times" size={22} color={theme.text} />
                </TouchableOpacity>
              </View>

              {participantLoading ? (
                <View style={styles.participantLoadingBox}>
                  <ActivityIndicator size="small" color={theme.tint} />
                </View>
              ) : participantMembers.length === 0 ? (
                <View style={styles.participantEmptyBox}>
                  <Text style={styles.participantEmptyText}>
                    {participantModalHeading === '그룹 멤버' ? '그룹 멤버가 없어요.' : '아직 참석 멤버가 없어요.'}
                  </Text>
                </View>
              ) : (
                <ScrollView style={styles.participantList} contentContainerStyle={styles.participantListContent}>
                  {participantMembers.map((member) => (
                    <View key={member.user_id} style={styles.participantItem}>
                      {member.avatar_url ? (
                        <Image source={{ uri: member.avatar_url }} style={styles.participantAvatar} />
                      ) : (
                        <View style={styles.participantAvatarFallback}>
                          <FontAwesome name="user" size={14} color="#8A96A3" />
                        </View>
                      )}
                      <Text style={[styles.participantName, { color: theme.text }]} numberOfLines={1}>
                        {member.display_name}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}
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
          <View style={styles.emptyActions}>
            <TouchableOpacity
              style={[styles.emptyActionBtn, { backgroundColor: '#FEE500' }]}
              onPress={() => setJoinGroupModal(true)}
            >
              <FontAwesome name="sign-in" size={13} color="#3B1D1D" />
              <Text style={[styles.emptyActionText, { color: '#3B1D1D' }]}>코드로 참여</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.emptyActionBtn, { backgroundColor: theme.tint }]}
              onPress={() => setCreateGroupModal(true)}
            >
              <FontAwesome name="plus" size={13} color="#FFF" />
              <Text style={styles.emptyActionText}>그룹 만들기</Text>
            </TouchableOpacity>
          </View>
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
              <TouchableOpacity onPress={() => setCreateGroupModal(false)} disabled={isCreatingGroup}>
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
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: theme.tint }, isCreatingGroup && styles.submitBtnDisabled]}
              onPress={handleCreateGroup}
              disabled={isCreatingGroup}
            >
              {isCreatingGroup
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={styles.submitBtnText}>만들기</Text>
              }
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
              <TouchableOpacity onPress={() => setJoinGroupModal(false)} disabled={isJoiningGroup}>
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
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#FEE500' }, isJoiningGroup && styles.submitBtnDisabled]}
              onPress={handleJoinGroup}
              disabled={isJoiningGroup}
            >
              {isJoiningGroup
                ? <ActivityIndicator size="small" color="#3B1D1D" />
                : <Text style={[styles.submitBtnText, { color: '#3B1D1D' }]}>💬 참여하기</Text>
              }
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
  hikeHeaderTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backBtnText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 3, marginBottom: 14 },
  headerActions: { flexDirection: 'row', gap: 10 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
  addBtnText: { color: '#1DB954', fontWeight: '700', fontSize: 13 },
  groupMemberPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  groupMemberPillText: { color: '#1DB954', fontSize: 12, fontWeight: '800' },
  listPad: { padding: 18, paddingTop: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#333', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  emptyActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 18 },
  emptyActionText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

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
  hikeTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  hikeBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  hikeBadgeText: { fontSize: 12, fontWeight: '700' },
  attendanceBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  attendanceBadgeText: { fontSize: 12, fontWeight: '800' },
  hikeMountainTitle: { fontSize: 18, color: '#1DB954', fontWeight: '800', marginBottom: 10 },
  hikeMetaCol: { gap: 5, marginBottom: 8 },
  hikeMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hikeMetaText: { fontSize: 13, color: '#666' },
  summaryBox: { backgroundColor: '#F0FAF4', padding: 12, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#1DB954', marginTop: 8 },
  summaryLabel: { fontSize: 12, fontWeight: '700', color: '#1DB954', marginBottom: 4 },
  summaryText: { fontSize: 13, lineHeight: 20 },
  hikeFooter: { gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  participantsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  participantsText: { fontSize: 13, color: '#999' },
  hikeActionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  hikeActionButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  attendButton: { backgroundColor: '#1DB954' },
  attendButtonText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  cancelAttendanceButton: { backgroundColor: '#F2F4F6' },
  cancelAttendanceButtonText: { color: '#666', fontSize: 13, fontWeight: '800' },
  editHikeButton: { backgroundColor: '#E8F8EE', borderWidth: 1, borderColor: '#BFEACD' },
  editHikeButtonText: { color: '#1DB954', fontSize: 13, fontWeight: '800' },
  deleteHikeButton: { backgroundColor: '#FFF2F2', borderWidth: 1, borderColor: '#FFD6D6' },
  deleteHikeButtonText: { color: '#FF4B4B', fontSize: 13, fontWeight: '800' },
  manualCompleteButton: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9' },
  manualCompleteButtonText: { color: '#2E7D32', fontSize: 13, fontWeight: '800' },
  groupStartButton: { backgroundColor: '#1DB954' },
  groupStartButtonDisabled: { backgroundColor: '#B8C2BB', opacity: 0.65 },
  groupStartButtonText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  recordHikeButton: { backgroundColor: '#2E7D32' },
  recordHikeButtonText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

  // Modals
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalBox: { borderRadius: 25, padding: 24 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  participantModalBox: { borderRadius: 22, padding: 22, maxHeight: '70%' },
  participantTitleBox: { flex: 1, paddingRight: 14 },
  participantSubtitle: { fontSize: 12, color: '#999', marginTop: 3 },
  participantLoadingBox: { minHeight: 120, justifyContent: 'center', alignItems: 'center' },
  participantEmptyBox: { minHeight: 100, justifyContent: 'center', alignItems: 'center' },
  participantEmptyText: { fontSize: 14, color: '#999' },
  participantList: { maxHeight: 320 },
  participantListContent: { gap: 10 },
  participantItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  participantAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#E9EEF2' },
  participantAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E9EEF2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantName: { flex: 1, fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 12, fontSize: 15 },
  dateTimeRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  dateTimeButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateTimeButtonText: { flex: 1, fontSize: 15, fontWeight: '700' },
  codeInput: { textAlign: 'center', letterSpacing: 4, fontSize: 20, fontWeight: '800' },
  hint: { fontSize: 12, color: '#999', marginBottom: 14, lineHeight: 18 },
  submitBtn: { padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled: { opacity: 0.65 },
  submitBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});
