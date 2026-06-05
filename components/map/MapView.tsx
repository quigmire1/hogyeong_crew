import React, { useMemo } from 'react';
import { Image, StyleSheet, View, Platform } from 'react-native';

let NativeMapView: any = View;
let Marker: any = View;
let Polyline: any = View;
let WMSTile: any = View;
let PROVIDER_GOOGLE: any = null;
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const maps = require('react-native-maps');
  NativeMapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
  WMSTile = maps.WMSTile;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
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


export default function MapView({ currentLocation, routeCoordinates = [], photos = [] }: MapViewProps) {
  const currentRegion = useMemo(() => ({
    latitude: currentLocation?.latitude || 37.5665,
    longitude: currentLocation?.longitude || 126.9780,
    latitudeDelta: 0.0102,
    longitudeDelta: 0.0047,
  }), [currentLocation?.latitude, currentLocation?.longitude]);

  const shouldRenderVWorldTiles = Platform.OS !== 'web' && Boolean(process.env.EXPO_PUBLIC_VWORLD_API_KEY);

  return (
    <View style={styles.container}>
      <NativeMapView
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        mapType="standard"
        initialRegion={currentRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
      >
        {shouldRenderVWorldTiles && (
          <WMSTile
            urlTemplate={`https://api.vworld.kr/req/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=lt_l_frstclimb&STYLES=lt_l_frstclimb&CRS=EPSG:3857&BBOX={minX},{minY},{maxX},{maxY}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&KEY=${process.env.EXPO_PUBLIC_VWORLD_API_KEY}`}
            zIndex={1}
            opacity={0.8}
            tileSize={256}
          />
        )}

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
});
