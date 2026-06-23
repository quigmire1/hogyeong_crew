import { FontAwesome } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  requireNativeComponent,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getTrackingMapProvider } from '../utils/mapProvider';
import {
  LocationSearchResult,
  reverseGeocodeLocation,
  searchLocations,
} from '../utils/geocoding';

let NativeMapView: any = View;
let Marker: any = View;
let PROVIDER_GOOGLE: any = null;
let HogyeongKakaoMapView: any = null;

if (Platform.OS === 'android' || Platform.OS === 'ios') {
  try {
    HogyeongKakaoMapView = requireNativeComponent<any>('HogyeongKakaoMapView');
  } catch {
    HogyeongKakaoMapView = null;
  }
}

if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps');
  NativeMapView = maps.default;
  Marker = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
}

type Coordinate = {
  latitude: number;
  longitude: number;
};

type Props = {
  visible: boolean;
  title: string;
  initialName?: string;
  initialCoordinate?: Coordinate | null;
  isDark?: boolean;
  searchPlaceholder?: string;
  namePlaceholder?: string;
  applyLabel?: string;
  markerTitle?: string;
  onClose: () => void;
  onSelect: (location: { name: string; latitude: number; longitude: number }) => void;
};

const DEFAULT_COORDINATE = { latitude: 37.5665, longitude: 126.9780 };
const kakaoNativeAppKey = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY || '';

export default function HikeLocationPicker({
  visible,
  title,
  initialName = '',
  initialCoordinate,
  isDark = false,
  searchPlaceholder = '장소명 검색',
  namePlaceholder = '저장할 장소명',
  applyLabel = '선택하기',
  markerTitle = '선택 위치',
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [selected, setSelected] = useState<Coordinate>(DEFAULT_COORDINATE);
  const [hasCoordinate, setHasCoordinate] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<Coordinate | null>(null);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [searchTouched, setSearchTouched] = useState(false);

  const mapProvider = getTrackingMapProvider(selected);
  const shouldUseKakaoMap = mapProvider === 'kakao' && Boolean(kakaoNativeAppKey) && Boolean(HogyeongKakaoMapView);

  useEffect(() => {
    if (!visible) return;

    const coordinate = initialCoordinate ?? DEFAULT_COORDINATE;
    setQuery(initialName);
    setPlaceName(initialName);
    setSelected(coordinate);
    setHasCoordinate(Boolean(initialCoordinate));
    setCurrentLocation(null);
    setResults([]);
    setSearchTouched(false);

    if (!initialCoordinate) {
      void moveToCurrentLocation(false);
    }
  // Opening the modal should initialize from the latest props once; live location updates are user-triggered afterwards.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCoordinate, initialName, visible]);

  useEffect(() => {
    if (!visible) return;

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearchTouched(false);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(() => {
      searchLocations(trimmed)
        .then((items) => {
          setResults(items);
          setSearchTouched(true);
        })
        .catch(() => {
          setResults([]);
          setSearchTouched(true);
        })
        .finally(() => setIsSearching(false));
    }, 280);

    return () => clearTimeout(timer);
  }, [query, visible]);

  const region = useMemo(() => ({
    ...selected,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  }), [selected]);

  const kakaoCamera = useMemo(() => ({
    lat: selected.latitude,
    lng: selected.longitude,
    zoomLevel: 15,
    animationDuration: 250,
  }), [selected.latitude, selected.longitude]);

  const handlePickResult = (result: LocationSearchResult) => {
    setSelected({ latitude: result.latitude, longitude: result.longitude });
    setHasCoordinate(true);
    setPlaceName(result.title);
    setQuery(result.title);
    setResults([]);
    setSearchTouched(false);
  };

  const handleLongPress = async (event: any) => {
    const coordinate = event.nativeEvent.coordinate as Coordinate;
    setSelected(coordinate);
    setHasCoordinate(true);

    const address = await reverseGeocodeLocation(coordinate.latitude, coordinate.longitude);
    if (address) {
      setPlaceName(address);
      setQuery(address);
    }
  };

  const moveToCurrentLocation = async (selectAsPlace = true) => {
    if (isLocating) return;

    setIsLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coordinate = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      setCurrentLocation(coordinate);
      setSelected(coordinate);
      if (selectAsPlace) {
        setHasCoordinate(true);
        const address = await reverseGeocodeLocation(coordinate.latitude, coordinate.longitude);
        const name = address ?? '내 위치';
        setPlaceName(name);
        setQuery(name);
      }
    } finally {
      setIsLocating(false);
    }
  };

  const handleApply = () => {
    const name = placeName.trim();
    if (!name || !hasCoordinate) return;

    onSelect({ name, latitude: selected.latitude, longitude: selected.longitude });
    onClose();
  };

  const renderMap = () => {
    if (shouldUseKakaoMap) {
      return (
        <HogyeongKakaoMapView
          style={styles.map}
          appKey={kakaoNativeAppKey}
          initialCamera={kakaoCamera}
          camera={kakaoCamera}
          currentLocation={hasCoordinate ? selected : currentLocation}
          baseMapType="map"
          language="ko"
          poiEnabled
          isShowCompass
          isShowScaleBar
        />
      );
    }

    return (
      <NativeMapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        region={region}
        showsUserLocation={true}
        showsMyLocationButton={false}
        onLongPress={handleLongPress}
      >
        {hasCoordinate ? <Marker coordinate={selected} title={placeName || markerTitle} /> : null}
      </NativeMapView>
    );
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: isDark ? '#FFF' : '#111' }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <FontAwesome name="times" size={22} color={isDark ? '#FFF' : '#111'} />
            </TouchableOpacity>
          </View>

          <View style={[styles.searchBox, { backgroundColor: isDark ? '#2A2A2A' : '#F6F8F7' }]}>
            <FontAwesome name="search" size={15} color={isDark ? '#777' : '#88928C'} />
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#FFF' : '#111' }]}
              placeholder={searchPlaceholder}
              placeholderTextColor={isDark ? '#777' : '#999'}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {isSearching ? <ActivityIndicator size="small" color="#1DB954" /> : null}
          </View>

          {results.length > 0 ? (
            <FlatList
              style={styles.results}
              keyboardShouldPersistTaps="handled"
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultItem} onPress={() => handlePickResult(item)}>
                  <View style={styles.resultTitleRow}>
                    <Text style={[styles.resultTitle, { color: isDark ? '#FFF' : '#222' }]} numberOfLines={1}>{item.title}</Text>
                    {item.provider ? <Text style={styles.resultProvider}>{item.provider === 'kakao' ? 'Kakao' : 'Google'}</Text> : null}
                  </View>
                  {item.subtitle ? <Text style={styles.resultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                </TouchableOpacity>
              )}
            />
          ) : searchTouched && query.trim().length >= 2 && !isSearching ? (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyResultsText}>검색 결과가 없습니다</Text>
            </View>
          ) : null}

          <View style={styles.mapBox}>
            {renderMap()}
            <View style={styles.providerBadge}>
              <Text style={styles.providerBadgeText}>{shouldUseKakaoMap ? 'Kakao' : 'Google'}</Text>
            </View>
            <TouchableOpacity
              style={[styles.myLocationButton, isLocating && styles.myLocationButtonDisabled]}
              onPress={() => moveToCurrentLocation(true)}
              disabled={isLocating}
            >
              {isLocating
                ? <ActivityIndicator size="small" color="#111827" />
                : <FontAwesome name="location-arrow" size={17} color="#111827" />
              }
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.nameInput, { color: isDark ? '#FFF' : '#111', backgroundColor: isDark ? '#2A2A2A' : '#F6F8F7' }]}
            placeholder={namePlaceholder}
            placeholderTextColor={isDark ? '#777' : '#999'}
            value={placeName}
            onChangeText={setPlaceName}
          />

          <TouchableOpacity
            style={[styles.applyButton, (!placeName.trim() || !hasCoordinate) && styles.disabledButton]}
            onPress={handleApply}
            disabled={!placeName.trim() || !hasCoordinate}
          >
            <Text style={styles.applyButtonText}>{applyLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 18 },
  sheet: { width: '100%', maxHeight: '88%', borderRadius: 22, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900' },
  searchBox: { minHeight: 46, borderRadius: 12, paddingHorizontal: 13, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  results: { maxHeight: 154, marginBottom: 10 },
  resultItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DDE5DF' },
  resultTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  resultProvider: { overflow: 'hidden', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#E8F8EE', color: '#138A3D', fontSize: 10, fontWeight: '900' },
  resultSubtitle: { fontSize: 11, color: '#8A949E', marginTop: 2 },
  emptyResults: { minHeight: 42, justifyContent: 'center', marginBottom: 8 },
  emptyResultsText: { textAlign: 'center', color: '#8A949E', fontSize: 12, fontWeight: '700' },
  mapBox: { height: 250, borderRadius: 14, overflow: 'hidden', backgroundColor: '#E8F8EE', marginBottom: 10 },
  map: { flex: 1 },
  providerBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  providerBadgeText: { color: '#111827', fontSize: 11, fontWeight: '900' },
  myLocationButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 5,
  },
  myLocationButtonDisabled: { opacity: 0.7 },
  nameInput: { minHeight: 46, borderRadius: 12, paddingHorizontal: 13, fontSize: 15, marginBottom: 10 },
  applyButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1DB954' },
  disabledButton: { opacity: 0.5 },
  applyButtonText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
});
