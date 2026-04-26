import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView as NativeMapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

// 추후 다른 지도 API (예: 네이버 지도, 카카오 맵)로 변경할 경우
// 이 파일 내부만 수정하면 앱 전체의 지도가 변경되도록 모듈화된 컴포넌트입니다.

interface MapViewProps {
  currentLocation?: {
    latitude: number;
    longitude: number;
  };
}

export default function MapView({ currentLocation }: MapViewProps) {
  const initialRegion = {
    latitude: currentLocation?.latitude || 37.5665, // 기본값: 서울
    longitude: currentLocation?.longitude || 126.9780,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  };

  return (
    <View style={styles.container}>
      {/* iOS는 기본 애플 맵, Android는 구글 맵을 사용할 수 있도록 PROVIDER 설정을 유동적으로 할 수 있습니다. */}
      {/* 여기서는 안드로이드/iOS 모두 지원 가능한 기본 react-native-maps를 사용합니다. */}
      <NativeMapView
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {currentLocation && (
          <Marker
            coordinate={{
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
            }}
            title="현재 위치"
            description="등산 출발점"
          />
        )}
      </NativeMapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 20, // 귀여운 느낌을 위한 둥근 테두리
    margin: 10,
    borderWidth: 2,
    borderColor: '#FF6B6B', // 테마 포인트 컬러
  },
  map: {
    width: '100%',
    height: '100%',
  },
});
