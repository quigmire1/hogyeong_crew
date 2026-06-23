import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, requireNativeComponent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { getTrackingMapProvider } from '../../utils/mapProvider';

let NativeMapView: any = View;
let Marker: any = View;
let Polyline: any = View;
let PROVIDER_GOOGLE: any = null;
let KakaoMapView: any = null;
let KakaoMap: any = null;
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
  Polyline = maps.Polyline;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kakaoMaps = require('@react-native-kakao/map');
    KakaoMapView = kakaoMaps.KakaoMapView ?? kakaoMaps.default;
    KakaoMap = kakaoMaps.KakaoMap;
  } catch {
    KakaoMapView = null;
    KakaoMap = null;
  }
}




export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface MapPhoto {
  id?: number;
  latitude: number;
  longitude: number;
  local_uri: string;
  timestamp?: number;
}

interface MapViewProps {
  currentLocation?: Coordinate;
  routeCoordinates?: Coordinate[];
  photos?: MapPhoto[];
}

const kakaoNativeAppKey = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY || '';
let kakaoInitializePromise: Promise<void> | null = null;

const initializeKakaoMap = (): Promise<void> => {
  if (!KakaoMap || !kakaoNativeAppKey) {
    return Promise.resolve();
  }

  if (!kakaoInitializePromise) {
    kakaoInitializePromise = KakaoMap.initializeKakaoMapSDK(kakaoNativeAppKey);
  }

  return kakaoInitializePromise ?? Promise.resolve();
};

export default function MapView({ currentLocation, routeCoordinates = [], photos = [] }: MapViewProps) {
  const nativeMapRef = useRef<any>(null);
  const [recenterVersion, setRecenterVersion] = useState(0);
  const providerCoordinate = currentLocation ?? routeCoordinates[routeCoordinates.length - 1];
  const mapProvider = getTrackingMapProvider(providerCoordinate);
  const canUseHogyeongKakaoMap = (Platform.OS === 'android' || Platform.OS === 'ios') && Boolean(HogyeongKakaoMapView);
  const canUsePackageKakaoMap = !canUseHogyeongKakaoMap && Boolean(KakaoMapView);
  const shouldUseKakaoMap = Platform.OS !== 'web' && mapProvider === 'kakao' && Boolean(kakaoNativeAppKey) && (canUseHogyeongKakaoMap || canUsePackageKakaoMap);
  const [kakaoMapReady, setKakaoMapReady] = useState(false);
  const [kakaoMapError, setKakaoMapError] = useState<string | null>(null);

  const currentRegion = useMemo(() => ({
    latitude: currentLocation?.latitude || 37.5665,
    longitude: currentLocation?.longitude || 126.9780,
    latitudeDelta: 0.0102,
    longitudeDelta: 0.0047,
  }), [currentLocation?.latitude, currentLocation?.longitude]);

  const kakaoCamera = useMemo(() => ({
    lat: currentRegion.latitude,
    lng: currentRegion.longitude,
    zoomLevel: 15,
    animationDuration: recenterVersion > 0 ? 350 : 0,
  }), [currentRegion.latitude, currentRegion.longitude, recenterVersion]);

  const kakaoPhotoMarkers = useMemo(() => photos.map((photo, index) => ({
    id: String(photo.id ?? photo.timestamp ?? index),
    latitude: photo.latitude,
    longitude: photo.longitude,
    localUri: photo.local_uri,
  })), [photos]);

  const centerOnCurrentLocation = () => {
    if (!currentLocation) return;

    setRecenterVersion((version) => version + 1);
    nativeMapRef.current?.animateToRegion?.(currentRegion, 350);
  };

  useEffect(() => {
    let isMounted = true;

    if (!shouldUseKakaoMap) {
      setKakaoMapReady(false);
      setKakaoMapError(null);
      return;
    }

    if (canUseHogyeongKakaoMap) {
      setKakaoMapReady(true);
      setKakaoMapError(null);
      return;
    }

    initializeKakaoMap()
      .then(() => {
        if (isMounted) {
          setKakaoMapReady(true);
          setKakaoMapError(null);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setKakaoMapReady(false);
          setKakaoMapError(error instanceof Error ? error.message : 'Kakao map initialization failed.');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canUseHogyeongKakaoMap, shouldUseKakaoMap]);

  if (shouldUseKakaoMap && kakaoMapReady && !kakaoMapError) {
    const KakaoMapComponent = canUseHogyeongKakaoMap ? HogyeongKakaoMapView : KakaoMapView;

    return (
      <View style={styles.container}>
        <KakaoMapComponent
          style={styles.map}
          appKey={kakaoNativeAppKey}
          initialCamera={kakaoCamera}
          camera={kakaoCamera}
          currentLocation={currentLocation}
          routeCoordinates={routeCoordinates}
          photoMarkers={kakaoPhotoMarkers}
          baseMapType="map"
          language="ko"
          poiEnabled
          isShowCompass
          isShowScaleBar
        />
        <View style={styles.providerBadge}>
          <Text style={styles.providerBadgeText}>Kakao</Text>
        </View>
        {currentLocation && (
          <TouchableOpacity
            accessibilityLabel="내 위치로 이동"
            activeOpacity={0.85}
            style={styles.myLocationButton}
            onPress={centerOnCurrentLocation}
          >
            <MaterialIcons name="my-location" size={22} color="#111827" />
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <NativeMapView
        ref={nativeMapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        initialRegion={currentRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#2ECC71"
            strokeWidth={5}
            zIndex={10}
          />
        )}

        {photos.map((photo) => (
          <Marker
            key={`photo-${photo.id ?? `${photo.timestamp ?? 'no-ts'}-${photo.local_uri}`}`}
            coordinate={{ latitude: photo.latitude, longitude: photo.longitude }}
            title="촬영 포인트"
          >
            <View style={styles.markerContainer}>
              <Image source={{ uri: photo.local_uri }} style={styles.markerImage} />
            </View>
          </Marker>
        ))}
      </NativeMapView>
      <View style={styles.providerBadge}>
        <Text style={styles.providerBadgeText}>Google</Text>
      </View>
      {currentLocation && (
        <TouchableOpacity
          accessibilityLabel="내 위치로 이동"
          activeOpacity={0.85}
          style={styles.myLocationButton}
          onPress={centerOnCurrentLocation}
        >
          <MaterialIcons name="my-location" size={22} color="#111827" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 20,
    margin: 10,
    borderWidth: 2,
    borderColor: '#FF6B6B',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
    backgroundColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
  },
  markerImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  providerBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(17, 24, 39, 0.78)',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  providerBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  myLocationButton: {
    position: 'absolute',
    right: 12,
    bottom: 76,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
});
