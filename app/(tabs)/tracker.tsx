import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import MapView from '../../components/map/MapView';
import { Colors } from '../../constants/theme';
import { useColorScheme } from '../../hooks/use-color-scheme';

export default function TrackerScreen() {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>등산 트래커</Text>
      </View>
      
      <View style={styles.mapContainer}>
        <MapView />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={[styles.button, { backgroundColor: theme.tint }]}>
          <Text style={styles.buttonText}>등산 시작</Text>
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
  buttonText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
});
