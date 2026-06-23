import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import {
  LocationSearchResult,
  reverseGeocodeLocation,
  searchLocations,
} from '../utils/geocoding';

let NativeMapView: any = View;
let Marker: any = View;
let PROVIDER_GOOGLE: any = null;
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
  onClose: () => void;
  onSelect: (location: { name: string; latitude: number; longitude: number }) => void;
};

const DEFAULT_COORDINATE = { latitude: 37.5665, longitude: 126.9780 };

export default function HikeLocationPicker({
  visible,
  title,
  initialName = '',
  initialCoordinate,
  isDark = false,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [selected, setSelected] = useState<Coordinate>(DEFAULT_COORDINATE);
  const [hasCoordinate, setHasCoordinate] = useState(false);
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!visible) return;

    const coordinate = initialCoordinate ?? DEFAULT_COORDINATE;
    setQuery(initialName);
    setPlaceName(initialName);
    setSelected(coordinate);
    setHasCoordinate(Boolean(initialCoordinate));
    setResults([]);
  }, [initialCoordinate, initialName, visible]);

  const region = useMemo(() => ({
    ...selected,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  }), [selected]);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;

    setIsSearching(true);
    try {
      setResults(await searchLocations(trimmed));
    } finally {
      setIsSearching(false);
    }
  };

  const handlePickResult = (result: LocationSearchResult) => {
    setSelected({ latitude: result.latitude, longitude: result.longitude });
    setHasCoordinate(true);
    setPlaceName(result.title);
    setQuery(result.title);
    setResults([]);
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

  const handleApply = () => {
    const name = placeName.trim();
    if (!name || !hasCoordinate) return;

    onSelect({ name, latitude: selected.latitude, longitude: selected.longitude });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: isDark ? '#1A1A1A' : '#FFF' }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: isDark ? '#FFF' : '#111' }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <FontAwesome name="times" size={22} color={isDark ? '#FFF' : '#111'} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={[styles.searchInput, { color: isDark ? '#FFF' : '#111', backgroundColor: isDark ? '#2A2A2A' : '#F6F8F7' }]}
              placeholder="장소명 검색"
              placeholderTextColor={isDark ? '#777' : '#999'}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            <TouchableOpacity style={styles.searchButton} onPress={handleSearch} disabled={isSearching}>
              {isSearching
                ? <ActivityIndicator size="small" color="#FFF" />
                : <FontAwesome name="search" size={16} color="#FFF" />
              }
            </TouchableOpacity>
          </View>

          {results.length > 0 ? (
            <FlatList
              style={styles.results}
              keyboardShouldPersistTaps="handled"
              data={results}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultItem} onPress={() => handlePickResult(item)}>
                  <Text style={[styles.resultTitle, { color: isDark ? '#FFF' : '#222' }]} numberOfLines={1}>{item.title}</Text>
                  {item.subtitle ? <Text style={styles.resultSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                </TouchableOpacity>
              )}
            />
          ) : null}

          <View style={styles.mapBox}>
            <NativeMapView
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              region={region}
              onLongPress={handleLongPress}
            >
              {hasCoordinate ? <Marker coordinate={selected} title={placeName || '집결지'} /> : null}
            </NativeMapView>
          </View>

          <TextInput
            style={[styles.nameInput, { color: isDark ? '#FFF' : '#111', backgroundColor: isDark ? '#2A2A2A' : '#F6F8F7' }]}
            placeholder="저장할 장소명"
            placeholderTextColor={isDark ? '#777' : '#999'}
            value={placeName}
            onChangeText={setPlaceName}
          />

          <TouchableOpacity
            style={[styles.applyButton, (!placeName.trim() || !hasCoordinate) && styles.disabledButton]}
            onPress={handleApply}
            disabled={!placeName.trim() || !hasCoordinate}
          >
            <Text style={styles.applyButtonText}>집결지로 선택</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '900' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, minHeight: 46, borderRadius: 12, paddingHorizontal: 13, fontSize: 15 },
  searchButton: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1DB954' },
  results: { maxHeight: 144, marginBottom: 10 },
  resultItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#DDE5DF' },
  resultTitle: { fontSize: 14, fontWeight: '800' },
  resultSubtitle: { fontSize: 11, color: '#8A949E', marginTop: 2 },
  mapBox: { height: 290, borderRadius: 14, overflow: 'hidden', backgroundColor: '#E8F8EE', marginBottom: 10 },
  map: { flex: 1 },
  nameInput: { minHeight: 46, borderRadius: 12, paddingHorizontal: 13, fontSize: 15, marginBottom: 10 },
  applyButton: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1DB954' },
  disabledButton: { opacity: 0.5 },
  applyButtonText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
});
