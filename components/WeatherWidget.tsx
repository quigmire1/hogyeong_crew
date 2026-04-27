import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Ionicons } from '@expo/vector-icons';

// Open-Meteo WMO Weather Code Mapping
const getWeatherDescription = (code: number) => {
  if (code === 0) return { text: '맑음', icon: 'sunny' as const };
  if (code === 1 || code === 2 || code === 3) return { text: '구름조금/흐림', icon: 'partly-sunny' as const };
  if (code === 45 || code === 48) return { text: '안개', icon: 'cloud-offline' as const };
  if (code >= 51 && code <= 67) return { text: '비/이슬비', icon: 'rainy' as const };
  if (code >= 71 && code <= 77) return { text: '눈', icon: 'snow' as const };
  if (code >= 80 && code <= 82) return { text: '소나기', icon: 'water' as const };
  if (code >= 95 && code <= 99) return { text: '천둥번개', icon: 'thunderstorm' as const };
  return { text: '알 수 없음', icon: 'cloud' as const };
};

export function WeatherWidget() {
  const [weather, setWeather] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setErrorMsg('위치 권한이 필요합니다.');
          setLoading(false);
          return;
        }

        let location = await Location.getCurrentPositionAsync({});
        const lat = location.coords.latitude;
        const lon = location.coords.longitude;

        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`
        );
        const data = await response.json();
        setWeather(data.current);
      } catch (error) {
        setErrorMsg('날씨 정보를 가져오는 데 실패했습니다.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="small" color="#0000ff" />
        <ThemedText style={{ marginLeft: 10 }}>날씨 정보를 불러오는 중...</ThemedText>
      </ThemedView>
    );
  }

  if (errorMsg) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
      </ThemedView>
    );
  }

  if (!weather) return null;

  const weatherInfo = getWeatherDescription(weather.weather_code);

  return (
    <ThemedView style={styles.container}>
      <Ionicons name={weatherInfo.icon} size={32} color="#007AFF" />
      <ThemedView style={styles.infoContainer}>
        <ThemedText type="defaultSemiBold" style={styles.temperature}>
          {weather.temperature_2m}°C
        </ThemedText>
        <ThemedText type="default">{weatherInfo.text}</ThemedText>
      </ThemedView>
      <ThemedView style={styles.detailsContainer}>
        <ThemedText type="default">습도: {weather.relative_humidity_2m}%</ThemedText>
        <ThemedText type="default">풍속: {weather.wind_speed_10m}km/h</ThemedText>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(150, 150, 150, 0.1)',
    marginVertical: 10,
  },
  infoContainer: {
    marginLeft: 12,
    marginRight: 'auto',
    backgroundColor: 'transparent',
  },
  temperature: {
    fontSize: 20,
  },
  detailsContainer: {
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  errorText: {
    color: '#ff4444',
  },
});
