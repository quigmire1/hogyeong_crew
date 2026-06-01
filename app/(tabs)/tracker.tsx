import { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome } from '@expo/vector-icons';
import MapView, { Coordinate } from '../../components/map/MapView';
import { Colors } from '../../constants/theme';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { getCurrentSessionId, isLocationTaskRunning, setCurrentSessionId, startLocationTask, stopLocationTask } from '../../tasks/locationTask';
import { getAllLocations, getAllPhotos, insertLocation, insertPhoto, PhotoRecord, createSession, endSession, getLocationsBySession, getPhotosBySession, getAllSessions } from '../../utils/database';
import { calculateFloors } from '../../utils/elevation';
import { syncHikeBackupToCloud } from '../../utils/sync';
import { WeatherBadge } from '../../components/WeatherBadge';
import { fetchWeather, evaluateHikingSafety } from '../../utils/weather';
import { saveHikeSession } from '../../utils/weatherFairy';
import { useAuth } from '../../contexts/AuthContext';

export default function TrackerScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const router = useRouter();

  // 산행 세션 시작 시간 기록용
  const sessionStartRef = useRef<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTrackingAction, setIsTrackingAction] = useState(false);
  const currentSessionIdRef = useRef<string>('');
  
  // 등산 트래킹 상태
  const [isTracking, setIsTracking] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinate[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [elevationGain, setElevationGain] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRouteFromDB = useCallback(async (sessionIdOverride?: string) => {
    try {
      const sessionId = sessionIdOverride ?? currentSessionIdRef.current;
      const records = sessionId
        ? await getLocationsBySession(sessionId)
        : await getAllLocations();
      const coords = records.map(r => ({ latitude: r.latitude, longitude: r.longitude }));
      setRouteCoordinates(coords);
      
      const { calculateElevationGain } = await import('../../utils/elevation');
      const gain = calculateElevationGain(records);
      setElevationGain(gain);

      const photoRecords = sessionId
        ? await getPhotosBySession(sessionId)
        : await getAllPhotos();
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

  const requestTrackingPermissions = async () => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      throw new Error('위치 정보 접근 권한이 거부되었습니다.');
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      throw new Error('백그라운드 위치 권한이 필요합니다. 산행 경로를 기록하려면 "항상 허용" 권한을 허용해주세요.');
    }
  };

  useEffect(() => {
    let isMounted = true;

    const restoreTrackingState = async () => {
      try {
        const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        if (fgStatus !== 'granted') {
          if (isMounted) setErrorMsg('위치 정보 접근 권한이 거부되었습니다.');
          return;
        }

        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          Alert.alert(
            '백그라운드 위치 권한 필요',
            '앱이 백그라운드에 있을 때도 경로를 기록하려면 "항상 허용" 권한이 필요합니다.'
          );
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        if (!isMounted) return;
        setLocation(currentLocation);

        const activeSessionId = await getCurrentSessionId();
        const isTaskRunning = await isLocationTaskRunning();
        if (!isMounted) return;

        if (activeSessionId && isTaskRunning) {
          currentSessionIdRef.current = activeSessionId;

          const sessions = await getAllSessions();
          const activeSession = sessions.find((session) => session.id === activeSessionId);
          sessionStartRef.current = activeSession
            ? new Date(activeSession.started_at).toISOString()
            : null;

          setIsTracking(true);
          await loadRouteFromDB(activeSessionId);
          startRouteRefresh();
        } else if (activeSessionId && !isTaskRunning) {
          await setCurrentSessionId('');
        }
      } catch (error) {
        console.error('[Tracker] Failed to restore tracking state:', error);
      }
    };

    restoreTrackingState();

    return () => {
      isMounted = false;
      stopRouteRefresh();
    };
  }, [loadRouteFromDB, startRouteRefresh]);

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
    let weatherNotice = '';

    try {
      await stopLocationTask();
      stopRouteRefresh();
      setIsTracking(false);

      if (sessionId) {
        await endSession(sessionId);
        console.log('[Tracker] 세션 종료:', sessionId);
      }

      currentSessionIdRef.current = '';
      await setCurrentSessionId('');

      if (user && sessionStartRef.current && location) {
        try {
          const w = await fetchWeather(location.coords.latitude, location.coords.longitude);
          const safety = evaluateHikingSafety(w);
          await saveHikeSession({
            user_id: user.id,
            started_at: sessionStartRef.current,
            ended_at: new Date().toISOString(),
            weather_score: safety.score,
            temp: w.temp,
            wind_speed: w.windSpeed,
            location_name: w.cityName || undefined,
          });
          console.log('[WeatherFairy] 날씨 점수 저장됨:', safety.score);
        } catch (e) {
          weatherNotice = '\n\n날씨 지수 저장 실패: 산행 기록은 정상 저장되었습니다.';
          console.warn('[WeatherFairy] 날씨 점수 저장 실패:', e);
        }
      }

      await loadRouteFromDB(sessionId);
      Alert.alert(
        '산행 종료',
        `누적 상승 ${Math.floor(elevationGain)}m, 사진 ${photos.length}장으로 기록을 마쳤습니다.${weatherNotice}`,
        [
          { text: '계속 보기', style: 'cancel' },
          { text: '기록 보기', onPress: () => router.push('/records') },
        ],
      );
    } catch (error) {
      Alert.alert('종료 실패', error instanceof Error ? error.message : '산행 종료 중 문제가 발생했습니다.');
    } finally {
      setIsTrackingAction(false);
    }
  };

  const startTracking = async () => {
    if (isTrackingAction) return;

    setIsTrackingAction(true);
    let newSessionId = '';

    try {
      await requestTrackingPermissions();

      newSessionId = await createSession();
      currentSessionIdRef.current = newSessionId;
      await setCurrentSessionId(newSessionId);
      sessionStartRef.current = new Date().toISOString();
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

      await startLocationTask({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 5,
        foregroundService: {
          notificationTitle: '호경크루',
          notificationBody: '산행 경로를 백그라운드에서 기록 중입니다.',
          notificationColor: '#2ECC71',
        },
      });

      setIsTracking(true);
      startRouteRefresh();
    } catch (error) {
      await stopLocationTask();
      if (newSessionId) {
        await endSession(newSessionId);
      }
      currentSessionIdRef.current = '';
      await setCurrentSessionId('');
      setIsTracking(false);
      Alert.alert('시작 실패', error instanceof Error ? error.message : '산행 시작 중 문제가 발생했습니다.');
    } finally {
      setIsTrackingAction(false);
    }
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
  const floors = calculateFloors(elevationGain);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={[styles.title, { color: theme.text }]}>등산 트래커</Text>
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
            <ActivityIndicator size="large" color={theme.tint} />
            <Text style={{color: theme.text, marginTop: 10}}>{errorMsg || "위치 정보를 가져오는 중..."}</Text>
          </View>
        )}
        
        {isTracking && (
          <TouchableOpacity style={styles.fab} onPress={takePhoto}>
            <FontAwesome name="camera" size={24} color="#FFF" />
          </TouchableOpacity>
        )}
      </View>

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
              <Text style={styles.statLabel}>환산 층수</Text>
              <Text style={styles.statValue}>{floors}층</Text>
            </View>
          </View>
        )}
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: isTracking ? '#FF6B6B' : theme.tint }, isTrackingAction && styles.buttonDisabled]}
          onPress={isTracking ? stopTracking : startTracking}
          disabled={isTrackingAction}
        >
          <Text style={styles.buttonText}>
            {isTrackingAction ? '처리 중...' : isTracking ? '등산 종료' : '등산 시작'}
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
