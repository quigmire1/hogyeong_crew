import { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';
import { FontAwesome } from '@expo/vector-icons';
import MapView, { Coordinate } from '../../components/map/MapView';
import { Colors } from '../../constants/theme';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { getCurrentSessionId, isLocationTaskRunning, setCurrentSessionId, startLocationTask, stopLocationTask } from '../../tasks/locationTask';
import { insertLocation, insertPhoto, PhotoRecord, createSession, endSession, getLocationsBySession, getPhotosBySession, getAllSessions } from '../../utils/database';
import { calculateElevationGain } from '../../utils/elevation';
import { syncHikeBackupToCloud } from '../../utils/sync';
import { WeatherBadge } from '../../components/WeatherBadge';
import { fetchWeather, evaluateHikingSafety } from '../../utils/weather';
import { saveHikeSession } from '../../utils/weatherFairy';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../utils/supabase';

const isIosExpoGo = Platform.OS === 'ios' && Constants.appOwnership === 'expo';

const formatElapsedTime = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
};

const loadSessionSummary = async (sessionId: string) => {
  const [locationRecords, photoRecords] = await Promise.all([
    getLocationsBySession(sessionId),
    getPhotosBySession(sessionId),
  ]);

  return {
    elevationGain: calculateElevationGain(locationRecords),
    photoCount: photoRecords.length,
  };
};

const getParamString = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
);

export default function TrackerScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{
    groupHikeId?: string;
    groupHikeTitle?: string;
  }>();
  const requestedGroupHikeId = getParamString(params.groupHikeId);
  const requestedGroupHikeTitle = getParamString(params.groupHikeTitle);

  // 덩산 세션 시작 시간 기록용
  const sessionStartRef = useRef<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTrackingAction, setIsTrackingAction] = useState(false);
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  const currentSessionIdRef = useRef<string>('');
  
  // 덩산 트래킹 상태
  const [isTracking, setIsTracking] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [elevationGain, setElevationGain] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRunRef = useRef(0);
  const foregroundLocationSubRef = useRef<Location.LocationSubscription | null>(null);
  const [activeGroupHikeId, setActiveGroupHikeId] = useState<string | null>(requestedGroupHikeId ?? null);
  const [activeGroupHikeTitle, setActiveGroupHikeTitle] = useState<string | null>(requestedGroupHikeTitle ?? null);

  useEffect(() => {
    if (requestedGroupHikeId) {
      setActiveGroupHikeId(requestedGroupHikeId);
      setActiveGroupHikeTitle(requestedGroupHikeTitle ?? null);
    }
  }, [requestedGroupHikeId, requestedGroupHikeTitle]);

  const loadRouteFromDB = useCallback(async (sessionIdOverride?: string) => {
    try {
      const sessionId = sessionIdOverride ?? currentSessionIdRef.current;
      if (!sessionId) {
        setRouteCoordinates([]);
        setPhotos([]);
        setElevationGain(0);
        return;
      }

      const records = await getLocationsBySession(sessionId);
      const coords = records.map(r => ({ latitude: r.latitude, longitude: r.longitude }));
      setRouteCoordinates(coords);
      
      const gain = calculateElevationGain(records);
      setElevationGain(gain);

      const photoRecords = await getPhotosBySession(sessionId);
      setPhotos(photoRecords);

      if (records.length > 0) {
        const last = records[records.length - 1];
        setLocation((prev) => prev ? { ...prev, coords: { ...prev.coords, latitude: last.latitude, longitude: last.longitude, altitude: last.altitude } } : null);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const startRouteRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      loadRouteFromDB();
    }, 5000);
  }, [loadRouteFromDB]);

  const stopRouteRefresh = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const updateElapsedTime = useCallback(() => {
    if (!sessionStartRef.current) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = new Date(sessionStartRef.current).getTime();
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  }, []);

  const startElapsedTimer = useCallback(() => {
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
    }

    updateElapsedTime();
    elapsedIntervalRef.current = setInterval(updateElapsedTime, 1000);
  }, [updateElapsedTime]);

  const stopElapsedTimer = () => {
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  };

  const stopForegroundTracking = () => {
    foregroundLocationSubRef.current?.remove();
    foregroundLocationSubRef.current = null;
  };

  const clearStartCountdownTimer = () => {
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
  };

  const startForegroundTracking = useCallback(async (sessionId: string) => {
    stopForegroundTracking();

    foregroundLocationSubRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 5,
      },
      async (nextLocation) => {
        try {
          setLocation(nextLocation);
          await insertLocation(
            nextLocation.coords.latitude,
            nextLocation.coords.longitude,
            nextLocation.coords.altitude ?? 0,
            nextLocation.timestamp,
            sessionId,
          );
          await loadRouteFromDB(sessionId);
        } catch (e) {
          console.error('[Tracker] Failed to save foreground location:', e);
        }
      },
    );
  }, [loadRouteFromDB]);

  const requestTrackingPermissions = useCallback(async () => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      throw new Error('위치 정보 접근 권한이 거부되었습니다.');
    }

    if (isIosExpoGo) {
      return;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      throw new Error('백그라운드 위치 권한이 필요합니다. 덩산 경로를 기록하려면 "항상 허용" 권한을 허용해주세요.');
    }
  }, []);

  const prepareTrackingLocation = useCallback(async () => {
    await requestTrackingPermissions();

    const currentLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    setLocation(currentLocation);
    setRouteCoordinates([]);
    setPhotos([]);
    setElevationGain(0);
    setErrorMsg('덩산 시작 준비가 완료되었습니다.');
  }, [requestTrackingPermissions]);

  useEffect(() => {
    let isMounted = true;

    const restoreTrackingState = async () => {
      try {
        const activeSessionId = await getCurrentSessionId();
        if (!isMounted) return;

        if (!activeSessionId) {
          try {
            await prepareTrackingLocation();
          } catch (error) {
            if (!isMounted) return;
            setErrorMsg(error instanceof Error ? error.message : '위치 확인 중 문제가 발생했습니다.');
          }
          return;
        }

        try {
          await requestTrackingPermissions();
        } catch (error) {
          if (!isMounted) return;
          setErrorMsg(error instanceof Error ? error.message : '진행 중인 덩산을 복원하려면 위치 권한이 필요합니다.');
          await setCurrentSessionId('');
          currentSessionIdRef.current = '';
          setRouteCoordinates([]);
          setPhotos([]);
          setElevationGain(0);
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        if (!isMounted) return;
        setLocation(currentLocation);

        const isTaskRunning = isIosExpoGo ? false : await isLocationTaskRunning();
        if (!isMounted) return;

        if (activeSessionId && isTaskRunning) {
          currentSessionIdRef.current = activeSessionId;

          const sessions = await getAllSessions();
          const activeSession = sessions.find((session) => session.id === activeSessionId);
          sessionStartRef.current = activeSession
            ? new Date(activeSession.started_at).toISOString()
            : null;
          setActiveGroupHikeId(activeSession?.group_hike_id ?? null);
          setActiveGroupHikeTitle(activeSession?.group_hike_title ?? null);

          setIsTracking(true);
          await loadRouteFromDB(activeSessionId);
          startRouteRefresh();
          startElapsedTimer();
        } else if (activeSessionId && isIosExpoGo) {
          currentSessionIdRef.current = activeSessionId;

          const sessions = await getAllSessions();
          const activeSession = sessions.find((session) => session.id === activeSessionId);
          sessionStartRef.current = activeSession
            ? new Date(activeSession.started_at).toISOString()
            : null;
          setActiveGroupHikeId(activeSession?.group_hike_id ?? null);
          setActiveGroupHikeTitle(activeSession?.group_hike_title ?? null);

          setIsTracking(true);
          await loadRouteFromDB(activeSessionId);
          await startForegroundTracking(activeSessionId);
          startRouteRefresh();
          startElapsedTimer();
        } else if (activeSessionId && !isTaskRunning) {
          await setCurrentSessionId('');
          currentSessionIdRef.current = '';
          setActiveGroupHikeId(requestedGroupHikeId ?? null);
          setActiveGroupHikeTitle(requestedGroupHikeTitle ?? null);
          setRouteCoordinates([]);
          setPhotos([]);
          setElevationGain(0);
        }
      } catch (error) {
        console.error('[Tracker] Failed to restore tracking state:', error);
      }
    };

    restoreTrackingState();

    return () => {
      isMounted = false;
      countdownRunRef.current += 1;
      clearStartCountdownTimer();
      stopForegroundTracking();
      stopRouteRefresh();
      stopElapsedTimer();
    };
  }, [
    loadRouteFromDB,
    prepareTrackingLocation,
    requestTrackingPermissions,
    requestedGroupHikeId,
    requestedGroupHikeTitle,
    startElapsedTimer,
    startForegroundTracking,
    startRouteRefresh,
  ]);

  const handleSync = async () => {
    setIsSyncing(true);
    const success = await syncHikeBackupToCloud();
    setIsSyncing(false);
    if (success) {
      Alert.alert('동기화 완료', '모든 세션, 경로, 사진이 성공적으로 백업되었습니다.');
      // 화면 갱신
      loadRouteFromDB();
    } else {
      Alert.alert('동기화 실패', '일부 세션, 경로 또는 사진을 백업하지 못했습니다.');
    }
  };

  const stopTracking = async () => {
    if (isTrackingAction) return;

    setIsTrackingAction(true);
    const sessionId = currentSessionIdRef.current;
    const startedAt = sessionStartRef.current;
    let weatherNotice = '';

    try {
      stopForegroundTracking();
      if (!isIosExpoGo) {
        await stopLocationTask();
      }
      stopRouteRefresh();
      stopElapsedTimer();
      setIsTracking(false);

      if (sessionId) {
        await endSession(sessionId);
        console.log('[Tracker] 세션 종료:', sessionId);
      }

      currentSessionIdRef.current = '';
      await setCurrentSessionId('');

      if (user && startedAt && location) {
        try {
          const w = await fetchWeather(location.coords.latitude, location.coords.longitude);
          const safety = evaluateHikingSafety(w);
          await saveHikeSession({
            user_id: user.id,
            started_at: startedAt,
            ended_at: new Date().toISOString(),
            weather_score: safety.score,
            temp: w.temp,
            wind_speed: w.windSpeed,
            location_name: w.cityName || undefined,
          });
          console.log('[WeatherFairy] 날씨 점수 저장됨:', safety.score);
        } catch (e) {
          weatherNotice = '\n\n날씨 지수 저장 실패: 덩산 기록은 정상 저장되었습니다.';
          console.warn('[WeatherFairy] 날씨 점수 저장 실패:', e);
        }
      }

      const sessionSummary = sessionId
        ? await loadSessionSummary(sessionId)
        : { elevationGain, photoCount: photos.length };

      if (activeGroupHikeId && sessionId) {
        const { error: groupFinishError } = await supabase.rpc('finish_group_hike_recording', {
          p_hike_id: activeGroupHikeId,
          p_local_session_id: sessionId,
        });
        if (groupFinishError) {
          weatherNotice += `\n\n그룹 덩산 완료 상태 저장 실패: ${groupFinishError.message}`;
        }
      }

      sessionStartRef.current = null;
      setActiveGroupHikeId(requestedGroupHikeId ?? null);
      setActiveGroupHikeTitle(requestedGroupHikeTitle ?? null);
      setRouteCoordinates([]);
      setPhotos([]);
      setElevationGain(0);
      setElapsedSeconds(0);
      Alert.alert(
        '덩산 종료',
        `누적 상승 ${Math.floor(sessionSummary.elevationGain)}m, 사진 ${sessionSummary.photoCount}장으로 기록을 마쳤습니다.${weatherNotice}`,
        [
          { text: '계속 보기', style: 'cancel' },
          { text: '기록 보기', onPress: () => router.push('/records') },
        ],
      );
    } catch (error) {
      Alert.alert('종료 실패', error instanceof Error ? error.message : '덩산 종료 중 문제가 발생했습니다.');
    } finally {
      setIsTrackingAction(false);
    }
  };

  const startTracking = async () => {
    if (isTrackingAction) return;

    setIsTrackingAction(true);
    let newSessionId = '';
    const groupHikeIdForSession = requestedGroupHikeId ?? activeGroupHikeId;
    const groupHikeTitleForSession = requestedGroupHikeTitle ?? activeGroupHikeTitle;

    try {
      setErrorMsg(null);
      await requestTrackingPermissions();

      newSessionId = await createSession({
        groupHikeId: groupHikeIdForSession,
        groupHikeTitle: groupHikeTitleForSession,
      });
      currentSessionIdRef.current = newSessionId;
      await setCurrentSessionId(newSessionId);
      sessionStartRef.current = new Date().toISOString();
      setActiveGroupHikeId(groupHikeIdForSession ?? null);
      setActiveGroupHikeTitle(groupHikeTitleForSession ?? null);
      setElapsedSeconds(0);
      console.log('[Tracker] 새 세션 시작:', newSessionId);

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setLocation(currentLocation);

      await insertLocation(
        currentLocation.coords.latitude,
        currentLocation.coords.longitude,
        currentLocation.coords.altitude ?? 0,
        currentLocation.timestamp,
        newSessionId,
      );

      setRouteCoordinates([{ latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude }]);
      setPhotos([]);
      setElevationGain(0);

      if (isIosExpoGo) {
        await startForegroundTracking(newSessionId);
      } else {
        await startLocationTask({
          accuracy: Location.Accuracy.High,
          timeInterval: 10000,
          distanceInterval: 5,
          foregroundService: {
            notificationTitle: '덩산',
            notificationBody: '덩산 경로를 백그라운드에서 기록 중입니다.',
            notificationColor: '#2ECC71',
          },
        });
      }

      if (groupHikeIdForSession) {
        const { error: groupStartError } = await supabase.rpc('start_group_hike_recording', {
          p_hike_id: groupHikeIdForSession,
          p_local_session_id: newSessionId,
        });
        if (groupStartError) throw groupStartError;
      }

      setIsTracking(true);
      startRouteRefresh();
      startElapsedTimer();
    } catch (error) {
      stopForegroundTracking();
      if (!isIosExpoGo) {
        await stopLocationTask();
      }
      if (newSessionId) {
        await endSession(newSessionId);
      }
      currentSessionIdRef.current = '';
      await setCurrentSessionId('');
      setActiveGroupHikeId(requestedGroupHikeId ?? null);
      setActiveGroupHikeTitle(requestedGroupHikeTitle ?? null);
      setIsTracking(false);
      stopElapsedTimer();
      setElapsedSeconds(0);
      setErrorMsg(error instanceof Error ? error.message : '덩산 시작 중 문제가 발생했습니다.');
      Alert.alert('시작 실패', error instanceof Error ? error.message : '덩산 시작 중 문제가 발생했습니다.');
    } finally {
      setIsTrackingAction(false);
    }
  };

  const cancelStartCountdown = () => {
    countdownRunRef.current += 1;
    clearStartCountdownTimer();
    setStartCountdown(null);
  };

  const beginStartCountdown = () => {
    if (isTracking || isTrackingAction || startCountdown !== null) return;

    const runId = countdownRunRef.current + 1;
    countdownRunRef.current = runId;
    setErrorMsg(null);
    setStartCountdown(3);

    const tick = (nextCount: number) => {
      countdownTimeoutRef.current = setTimeout(() => {
        if (countdownRunRef.current !== runId) return;

        if (nextCount > 0) {
          setStartCountdown(nextCount);
          tick(nextCount - 1);
          return;
        }

        countdownTimeoutRef.current = null;
        setStartCountdown(null);
        startTracking();
      }, 1000);
    };

    tick(2);
  };

  const takePhoto = async () => {
    if (!location) {
      Alert.alert('오류', '현재 위치를 알 수 없어 사진을 찍을 수 없습니다.');
      return;
    }

    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('권한 필요', '카메라 권한이 필요합니다.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.5,
    });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      await insertPhoto(location.coords.latitude, location.coords.longitude, uri, Date.now(), currentSessionIdRef.current);
      loadRouteFromDB();
    }
  };

  const currentAltitude = location?.coords?.altitude ? Math.floor(location.coords.altitude) : 0;
  const elapsedTime = formatElapsedTime(elapsedSeconds);
  const headerTitle = activeGroupHikeTitle ?? '덩산 트래커';

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <View style={styles.titleBox}>
          {activeGroupHikeTitle ? <Text style={styles.groupTrackerLabel}>그룹 덩산</Text> : null}
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{headerTitle}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <WeatherBadge
            lat={location?.coords.latitude}
            lon={location?.coords.longitude}
          />
          <TouchableOpacity onPress={handleSync} disabled={isSyncing} style={{ padding: 10 }}>
            {isSyncing ? (
              <ActivityIndicator size="small" color={theme.tint} />
            ) : (
              <FontAwesome name="cloud-upload" size={24} color={theme.tint} />
            )}
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.mapContainer}>
        {location ? (
          <MapView currentLocation={location.coords} routeCoordinates={routeCoordinates} photos={photos} />
        ) : (
          <View style={[styles.loadingContainer, { backgroundColor: theme.background }]}>
            {!errorMsg && <ActivityIndicator size="large" color={theme.tint} />}
            <Text style={{color: theme.text, marginTop: 10}}>{errorMsg || "위치 정보를 가져오는 중..."}</Text>
          </View>
        )}
        
        {isTracking && (
          <TouchableOpacity style={styles.fab} onPress={takePhoto}>
            <FontAwesome name="camera" size={24} color="#FFF" />
          </TouchableOpacity>
        )}
      </View>

      {startCountdown !== null && (
        <View style={styles.countdownOverlay}>
          <Text style={styles.countdownNumber}>{startCountdown}</Text>
          <TouchableOpacity style={styles.countdownCancelButton} onPress={cancelStartCountdown}>
            <Text style={styles.countdownCancelText}>취소</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.controls}>
        {isTracking && (
          <View style={styles.statsContainer}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>현재 고도</Text>
              <Text style={styles.statValue}>{currentAltitude}m</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>누적 상승</Text>
              <Text style={styles.statValue}>{Math.floor(elevationGain)}m</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>진행시간</Text>
              <Text style={styles.statValue}>{elapsedTime}</Text>
            </View>
          </View>
        )}
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: isTracking ? '#FF6B6B' : theme.tint }, (isTrackingAction || startCountdown !== null) && styles.buttonDisabled]}
          onPress={isTracking ? stopTracking : beginStartCountdown}
          disabled={isTrackingAction || startCountdown !== null}
        >
          <Text style={styles.buttonText}>
            {isTrackingAction ? '처리 중...' : startCountdown !== null ? '곧 시작...' : isTracking ? '덩산 종료' : '덩산 시작'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingTop: 60,
    alignItems: 'center',
  },
  titleBox: {
    flex: 1,
    paddingRight: 12,
  },
  groupTrackerLabel: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '900', // 더 두껍고 둥근 느낌을 위해
  },
  mapContainer: {
    flex: 1,
  },
  controls: {
    padding: 20,
    paddingBottom: 40,
    backgroundColor: 'transparent',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 15,
    padding: 15,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statBox: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2ECC71',
  },
  button: {
    padding: 18,
    borderRadius: 30, // 귀여운 느낌의 둥근 버튼
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  countdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 20,
    elevation: 20,
  },
  countdownNumber: {
    color: '#FFF',
    fontSize: 120,
    fontWeight: '900',
    lineHeight: 132,
    textAlign: 'center',
  },
  countdownCancelButton: {
    marginTop: 28,
    minWidth: 160,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
  },
  countdownCancelText: {
    color: '#222',
    fontSize: 18,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    backgroundColor: '#FF6B6B',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 6,
  },
});
