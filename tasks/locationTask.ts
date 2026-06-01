import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insertLocation } from '../utils/database';

export const LOCATION_TASK_NAME = 'BACKGROUND_LOCATION_TASK';
const ACTIVE_LOCATION_SESSION_ID_KEY = 'hogyeong_crew.active_location_session_id';

export const setCurrentSessionId = async (id: string) => {
  if (!id) {
    await AsyncStorage.removeItem(ACTIVE_LOCATION_SESSION_ID_KEY);
    return;
  }

  await AsyncStorage.setItem(ACTIVE_LOCATION_SESSION_ID_KEY, id);
};

export const getCurrentSessionId = async () => (
  await AsyncStorage.getItem(ACTIVE_LOCATION_SESSION_ID_KEY)
) || '';

export const startLocationTask = async (
  options: Parameters<typeof Location.startLocationUpdatesAsync>[1],
) => {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (isRegistered) {
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, options);
};

export const isLocationTaskRunning = async () => {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
  if (!isRegistered) {
    return false;
  }

  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
};

export const stopLocationTask = async () => {
  const hasStarted = await isLocationTaskRunning();
  if (!hasStarted) {
    return;
  }

  await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
};

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      console.error('Background Location Task Error:', error);
      return;
    }

    if (data) {
      const { locations } = data as { locations: Location.LocationObject[] };
      if (locations && locations.length > 0) {
        const sessionId = await getCurrentSessionId();
        if (!sessionId) {
          console.warn(`[LocationTask] Active session id is missing. Skipping ${locations.length} background location(s).`);
          return;
        }

        for (const location of locations) {
          try {
            await insertLocation(
              location.coords.latitude,
              location.coords.longitude,
              location.coords.altitude ?? 0,
              location.timestamp,
              sessionId,
            );
            console.log(`Saved background location: ${location.coords.latitude}, ${location.coords.longitude} (session: ${sessionId})`);
          } catch (e) {
            console.error('Failed to save background location:', e);
          }
        }
      }
    }
  });
}
