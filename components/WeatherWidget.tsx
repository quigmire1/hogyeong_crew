// 홈 화면용 날씨 카드 — 날씨 정보 + 유의성 테스트 결과 표시
import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import * as Location from 'expo-location';
import {
  fetchWeather,
  evaluateHikingSafety,
  weatherIconToEmoji,
  WeatherData,
  SafetyResult,
} from '../utils/weather';

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [safety, setSafety] = useState<SafetyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('위치 권한이 필요합니다.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const w = await fetchWeather(loc.coords.latitude, loc.coords.longitude);
      setWeather(w);
      setSafety(evaluateHikingSafety(w));
    } catch (e: any) {
      setError(e.message ?? '날씨 정보를 가져올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#1DB954" />
        <Text style={styles.loadingText}>날씨 불러오는 중...</Text>
      </View>
    );
  }

  if (error || !weather || !safety) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error ?? '날씨 정보 없음'}</Text>
        <TouchableOpacity onPress={load} style={styles.retryButton}>
          <Text style={styles.retryText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const safetyColor = safety.level === 'safe' ? '#1DB954' : safety.level === 'caution' ? '#F39C12' : '#E74C3C';
  const safetBg = safety.level === 'safe' ? '#E8F8EE' : safety.level === 'caution' ? '#FEF9E7' : '#FDEDEC';

  return (
    <View style={styles.card}>
      {/* 메인 날씨 정보 */}
      <View style={styles.mainRow}>
        <View>
          <Text style={styles.emoji}>{weatherIconToEmoji(weather.icon)}</Text>
        </View>
        <View style={styles.tempSection}>
          <Text style={styles.temp}>{weather.temp}°C</Text>
          <Text style={styles.desc}>{weather.description}</Text>
          {weather.cityName ? <Text style={styles.city}>📍 {weather.cityName}</Text> : null}
        </View>
        <View style={styles.detailSection}>
          <Text style={styles.detail}>💧 {weather.humidity}%</Text>
          <Text style={styles.detail}>💨 {weather.windSpeed.toFixed(1)}m/s</Text>
          <Text style={styles.detail}>🌡️ 체감 {weather.feelsLike}°C</Text>
        </View>
      </View>

      {/* 유의성 테스트 결과 배너 */}
      <TouchableOpacity
        style={[styles.safetyBanner, { backgroundColor: safetBg, borderColor: safetyColor }]}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.8}
      >
        <View style={styles.safetyHeader}>
          <Text style={styles.safetyEmoji}>{safety.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.safetyTitle, { color: safetyColor }]}>
              덩산 안전 지수 {safety.score}점
            </Text>
            <Text style={[styles.safetyRec, { color: safetyColor }]} numberOfLines={expanded ? undefined : 1}>
              {safety.recommendation}
            </Text>
          </View>
          <Text style={{ color: safetyColor, fontSize: 16 }}>{expanded ? '▲' : '▼'}</Text>
        </View>

        {/* 펼침 — 유의 사항 상세 */}
        {expanded && safety.reasons.length > 0 && (
          <View style={styles.reasonsContainer}>
            {safety.reasons.map((r, i) => (
              <Text key={i} style={[styles.reasonText, { color: safetyColor }]}>• {r}</Text>
            ))}
          </View>
        )}
        {expanded && safety.reasons.length === 0 && (
          <Text style={[styles.reasonText, { color: safetyColor }]}>• 특별한 유의 사항 없음</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.attributionText}>데이터 제공: 기상청(공공데이터포털)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    gap: 14,
  },
  loadingText: {
    marginTop: 8,
    color: '#888',
    textAlign: 'center',
  },
  errorText: {
    color: '#E74C3C',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
  },
  retryText: {
    color: '#555',
    fontWeight: '600',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emoji: {
    fontSize: 48,
  },
  tempSection: {
    flex: 1,
  },
  temp: {
    fontSize: 32,
    fontWeight: '900',
    color: '#111',
  },
  desc: {
    fontSize: 14,
    color: '#555',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  city: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  detailSection: {
    alignItems: 'flex-end',
    gap: 4,
  },
  detail: {
    fontSize: 13,
    color: '#666',
  },
  safetyBanner: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  safetyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  safetyEmoji: {
    fontSize: 24,
  },
  safetyTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  safetyRec: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },
  reasonsContainer: {
    marginTop: 6,
    gap: 4,
    paddingLeft: 4,
  },
  reasonText: {
    fontSize: 13,
    lineHeight: 20,
  },
  attributionText: {
    fontSize: 10,
    color: '#AAA',
    textAlign: 'right',
    marginTop: -4,
    marginRight: 4,
  },
});
