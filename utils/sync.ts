import {
  CloudLocationRecord,
  CloudPhotoRecord,
  CloudSessionRecord,
  getUnsyncedLocations,
  getUnsyncedPhotos,
  getUnsyncedSessions,
  markAsSynced,
  markPhotoAsSynced,
  markPhotosAsSynced,
  markSessionsAsSynced,
  upsertLocationsFromCloud,
  upsertPhotosFromCloud,
  upsertSessionsFromCloud,
} from './database';
import { isLocalPhotoAvailable, uploadPhotoToSupabase } from './storage';
import { supabase, SUPABASE_TABLES } from './supabase';

export type PendingSyncCounts = {
  sessions: number;
  locations: number;
  photos: number;
  total: number;
};

const nullableString = (value?: string | null) => {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
};

const hasSessionId = (value?: string | null) => Boolean(nullableString(value));

const fetchAllCloudRows = async <T>(
  tableName: string,
  selectColumns: string,
  orderColumn: string,
): Promise<T[]> => {
  const pageSize = 1000;
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(selectColumns)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const pageRows = (data ?? []) as T[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
};

export const getPendingSyncCounts = async (): Promise<PendingSyncCounts> => {
  const [sessions, locations, photos] = await Promise.all([
    getUnsyncedSessions(),
    getUnsyncedLocations(),
    getUnsyncedPhotos(),
  ]);

  return {
    sessions: sessions.length,
    locations: locations.length,
    photos: photos.length,
    total: sessions.length + locations.length + photos.length,
  };
};

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
          group_hike_id: nullableString(session.group_hike_id),
          group_hike_title: nullableString(session.group_hike_title),
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

    const orphanLocationIds = unsyncedLocations
      .filter((location) => location.id && !hasSessionId(location.session_id))
      .map((location) => location.id!);
    if (orphanLocationIds.length > 0) {
      console.warn(`Skipping ${orphanLocationIds.length} location(s) without a session id.`);
      await markAsSynced(orphanLocationIds);
    }

    const syncableLocations = unsyncedLocations.filter((location) => (
      location.id && hasSessionId(location.session_id)
    ));
    if (syncableLocations.length === 0) {
      return true;
    }

    const { error } = await supabase
      .from(SUPABASE_TABLES.LOCATIONS)
      .upsert(
        syncableLocations.map((location) => ({
          local_id: location.id,
          session_id: nullableString(location.session_id),
          latitude: location.latitude,
          longitude: location.longitude,
          altitude: location.altitude,
          recorded_at: new Date(location.timestamp).toISOString(),
        })),
        { onConflict: 'user_id,local_id' },
      );

    if (error) {
      console.error('Location sync failed:', error.message);
      return false;
    }

    await markAsSynced(syncableLocations.map((location) => location.id!));
    console.log(`Successfully synced ${syncableLocations.length} locations.`);
    return syncableLocations.length + orphanLocationIds.length === unsyncedLocations.length;
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

    const orphanPhotoIds = unsyncedPhotos
      .filter((photo) => photo.id && !hasSessionId(photo.session_id))
      .map((photo) => photo.id!);
    if (orphanPhotoIds.length > 0) {
      console.warn(`Skipping ${orphanPhotoIds.length} photo(s) without a session id.`);
      await markPhotosAsSynced(orphanPhotoIds);
    }

    const missingLocalPhotoIds: number[] = [];

    for (const photo of unsyncedPhotos) {
      if (!photo.id || !hasSessionId(photo.session_id)) continue;

      if (!(await isLocalPhotoAvailable(photo.local_uri))) {
        console.warn(`Skipping photo ${photo.id} because the local file no longer exists.`);
        missingLocalPhotoIds.push(photo.id);
        continue;
      }
      
      console.log(`Syncing photo ${photo.id}...`);
      const uploadedPhoto = await uploadPhotoToSupabase(photo.local_uri, photo.timestamp);
      
      if (uploadedPhoto) {
        const { error } = await supabase
          .from(SUPABASE_TABLES.PHOTOS)
          .upsert(
            {
              local_id: photo.id,
              session_id: nullableString(photo.session_id),
              latitude: photo.latitude,
              longitude: photo.longitude,
              local_uri: photo.local_uri,
              remote_path: uploadedPhoto.path,
              public_url: uploadedPhoto.publicUrl,
              taken_at: new Date(photo.timestamp).toISOString(),
            },
            { onConflict: 'user_id,local_id' },
          );

        if (error) {
          console.error('Photo metadata sync failed:', error.message);
          continue;
        }

        await markPhotoAsSynced(photo.id, uploadedPhoto.path, uploadedPhoto.publicUrl);
      }
    }

    if (missingLocalPhotoIds.length > 0) {
      console.warn(
        `Marked ${missingLocalPhotoIds.length} missing local photo(s) as skipped so they do not block sync.`,
      );
      await markPhotosAsSynced(missingLocalPhotoIds);
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

export const restoreCloudBackupToLocal = async (): Promise<boolean> => {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      console.warn('[Sync] Skipping cloud restore because there is no signed-in user.');
      return false;
    }

    const [sessions, locations, photos] = await Promise.all([
      fetchAllCloudRows<CloudSessionRecord>(
        SUPABASE_TABLES.SESSIONS,
        'id, started_at, ended_at, group_hike_id, group_hike_title',
        'started_at',
      ),
      fetchAllCloudRows<CloudLocationRecord>(
        SUPABASE_TABLES.LOCATIONS,
        'local_id, session_id, latitude, longitude, altitude, recorded_at',
        'recorded_at',
      ),
      fetchAllCloudRows<CloudPhotoRecord>(
        SUPABASE_TABLES.PHOTOS,
        'local_id, session_id, latitude, longitude, local_uri, remote_path, public_url, taken_at',
        'taken_at',
      ),
    ]);

    await upsertSessionsFromCloud(sessions);
    await upsertLocationsFromCloud(locations);
    await upsertPhotosFromCloud(photos);

    console.log(
      `[Sync] Restored cloud backup to local DB: ${sessions.length} sessions, ${locations.length} locations, ${photos.length} photos.`,
    );
    return true;
  } catch (error) {
    console.error('[Sync] Failed to restore cloud backup:', error);
    return false;
  }
};
