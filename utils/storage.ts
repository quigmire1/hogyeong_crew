import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, SUPABASE_STORAGE_BUCKETS } from './supabase';

export type UploadedPhoto = {
  path: string;
  publicUrl: string | null;
};

export const readLocalFileAsArrayBuffer = async (localUri: string): Promise<ArrayBuffer> => {
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return decode(base64);
};

export const isLocalPhotoAvailable = async (localUri: string): Promise<boolean> => {
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    return info.exists && !info.isDirectory;
  } catch {
    return false;
  }
};

export const persistTrackerPhoto = async (sourceUri: string, timestamp: number): Promise<string> => {
  const directory = `${FileSystem.documentDirectory}tracking-photos`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });

  const extensionMatch = sourceUri.match(/\.([a-zA-Z0-9]+)(?:\?|#|$)/);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? 'jpg';
  const destinationUri = `${directory}/${timestamp}_${Date.now()}.${extension}`;

  await FileSystem.copyAsync({
    from: sourceUri,
    to: destinationUri,
  });

  return destinationUri;
};

/**
 * 로컬에 저장된 사진을 Supabase Storage의 'photos' 버킷으로 업로드합니다.
 * @param localUri 로컬 디바이스의 사진 파일 경로 (file://...)
 * @param timestamp 사진이 촬영된 타임스탬프
 * @returns 업로드된 파일의 경로와 public URL (에러 시 null)
 */
export const uploadPhotoToSupabase = async (localUri: string, timestamp: number): Promise<UploadedPhoto | null> => {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw userError ?? new Error('Cannot upload photo without a signed-in user.');
    }

    const fileName = `${Date.now()}_${timestamp}.jpg`;
    const remotePath = `${userData.user.id}/${fileName}`;
    if (!(await isLocalPhotoAvailable(localUri))) {
      throw new Error(`Local photo file is missing: ${localUri}`);
    }

    const fileData = await readLocalFileAsArrayBuffer(localUri);

    const { data, error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKETS.PHOTOS)
      .upload(remotePath, fileData, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      console.error('Supabase storage upload error:', error.message);
      return null;
    }

    const { data: publicUrlData } = supabase.storage
      .from(SUPABASE_STORAGE_BUCKETS.PHOTOS)
      .getPublicUrl(data.path);

    return {
      path: data.path,
      publicUrl: publicUrlData.publicUrl || null,
    };
  } catch (error) {
    console.error('Photo storage upload failed:', error);
    return null;
  }
};
