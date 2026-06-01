import {
  getUnsyncedLocations,
  getUnsyncedPhotos,
  getUnsyncedSessions,
  markAsSynced,
  markPhotoAsSynced,
  markSessionsAsSynced,
} from './database';
import { uploadPhotoToSupabase } from './storage';
import { supabase, SUPABASE_TABLES } from './supabase';

export const syncSessionsToCloud = async (): Promise<boolean> => {
  try {
    const unsyncedSessions = await getUnsyncedSessions();
    if (unsyncedSessions.length === 0) {
      console.log('No sessions to sync.');
      return true;
    }

    const { error } = await supabase
      .from(SUPABASE_TABLES.SESSIONS)
      .upsert(
        unsyncedSessions.map((session) => ({
          id: session.id,
          started_at: new Date(session.started_at).toISOString(),
          ended_at: session.ended_at === 0 ? null : new Date(session.ended_at).toISOString(),
        })),
        { onConflict: 'id' },
      );

    if (error) {
      console.error('Session sync failed:', error.message);
      return false;
    }

    await markSessionsAsSynced(unsyncedSessions.map((session) => session.id));
    console.log(`Successfully synced ${unsyncedSessions.length} sessions.`);
    return true;
  } catch (error) {
    console.error('Session sync failed:', error);
    return false;
  }
};

export const syncLocationsToCloud = async (): Promise<boolean> => {
  try {
    const unsyncedLocations = await getUnsyncedLocations();
    if (unsyncedLocations.length === 0) {
      console.log('No locations to sync.');
      return true;
    }

    const syncableLocations = unsyncedLocations.filter((location) => location.id);
    if (syncableLocations.length === 0) {
      return true;
    }

    const { error } = await supabase
      .from(SUPABASE_TABLES.LOCATIONS)
      .upsert(
        syncableLocations.map((location) => ({
          local_id: location.id,
          session_id: location.session_id,
          latitude: location.latitude,
          longitude: location.longitude,
          altitude: location.altitude,
          recorded_at: new Date(location.timestamp).toISOString(),
        })),
        { onConflict: 'local_id' },
      );

    if (error) {
      console.error('Location sync failed:', error.message);
      return false;
    }

    await markAsSynced(syncableLocations.map((location) => location.id!));
    console.log(`Successfully synced ${syncableLocations.length} locations.`);
    return syncableLocations.length === unsyncedLocations.length;
  } catch (error) {
    console.error('Location sync failed:', error);
    return false;
  }
};

/**
 * 로컬에 저장되었지만 아직 Supabase에 동기화되지 않은 사진들을 업로드하고 동기화 상태를 업데이트합니다.
 */
export const syncPhotosToCloud = async (): Promise<boolean> => {
  try {
    const unsyncedPhotos = await getUnsyncedPhotos();
    if (unsyncedPhotos.length === 0) {
      console.log('No photos to sync.');
      return true; // Already fully synced
    }

    for (const photo of unsyncedPhotos) {
      if (!photo.id) continue;
      
      console.log(`Syncing photo ${photo.id}...`);
      const uploadedPhoto = await uploadPhotoToSupabase(photo.local_uri, photo.timestamp);
      
      if (uploadedPhoto) {
        const { error } = await supabase
          .from(SUPABASE_TABLES.PHOTOS)
          .upsert(
            {
              local_id: photo.id,
              session_id: photo.session_id,
              latitude: photo.latitude,
              longitude: photo.longitude,
              local_uri: photo.local_uri,
              remote_path: uploadedPhoto.path,
              public_url: uploadedPhoto.publicUrl,
              taken_at: new Date(photo.timestamp).toISOString(),
            },
            { onConflict: 'local_id' },
          );

        if (error) {
          console.error('Photo metadata sync failed:', error.message);
          continue;
        }

        await markPhotoAsSynced(photo.id, uploadedPhoto.path, uploadedPhoto.publicUrl);
      }
    }

    const remainingPhotos = await getUnsyncedPhotos();
    const syncedCount = unsyncedPhotos.length - remainingPhotos.length;
    console.log(`Successfully synced ${syncedCount} photos.`);
    return remainingPhotos.length === 0;
  } catch (error) {
    console.error('Photo sync failed:', error);
    return false;
  }
};

export const syncHikeBackupToCloud = async (): Promise<boolean> => {
  const sessionsSynced = await syncSessionsToCloud();
  if (!sessionsSynced) {
    return false;
  }

  const locationsSynced = await syncLocationsToCloud();
  if (!locationsSynced) {
    return false;
  }

  return syncPhotosToCloud();
};
