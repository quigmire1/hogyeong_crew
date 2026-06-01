// 트래커 헤더용 소형 날씨 배지
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import {
  fetchWeather,
  evaluateHikingSafety,
  weatherIconToEmoji,
  WeatherData,
  SafetyResult,
} from '../utils/weather';

interface Props {
  lat?: number;
  lon?: number;
}

export function WeatherBadge({ lat, lon }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [safety, setSafety] = useState<SafetyResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let finalLat = lat;
        let finalLon = lon;

        if (!finalLat || !finalLon) {
          const loc = await Location.getCurrentPositionAsync({});
          finalLat = loc.coords.latitude;
          finalLon = loc.coords.longitude;
        }

        const w = await fetchWeather(finalLat, finalLon);
        setWeather(w);
        setSafety(evaluateHikingSafety(w));
      } catch {
        // 실패 시 조용히 무시 (트래커 헤더이므로 에러 노출 최소화)
      } finally {
        setLoading(false);
      }
    })();
  }, [lat, lon]);

  if (loading) return <ActivityIndicator size="small" color="#FFF" style={{ marginRight: 8 }} />;
  if (!weather || !safety) return null;

  const safetyColor = safety.level === 'safe' ? '#2ECC71' : safety.level === 'caution' ? '#F39C12' : '#E74C3C';

  return (
    <View style={styles.badge}>
      <Text style={styles.icon}>{weatherIconToEmoji(weather.icon)}</Text>
      <Text style={styles.temp}>{weather.temp}°C</Text>
      <View style={[styles.dot, { backgroundColor: safetyColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
    marginRight: 8,
  },
  icon: {
    fontSize: 16,
  },
  temp: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});
