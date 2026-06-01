import { supabase, SUPABASE_STORAGE_BUCKETS } from './supabase';

export type UploadedPhoto = {
  path: string;
  publicUrl: string | null;
};

/**
 * 로컬에 저장된 사진을 Supabase Storage의 'photos' 버킷으로 업로드합니다.
 * @param localUri 로컬 디바이스의 사진 파일 경로 (file://...)
 * @param timestamp 사진이 촬영된 타임스탬프
 * @returns 업로드된 파일의 경로와 public URL (에러 시 null)
 */
export const uploadPhotoToSupabase = async (localUri: string, timestamp: number): Promise<UploadedPhoto | null> => {
  try {
    const fileName = `${Date.now()}_${timestamp}.jpg`;
    
    // React Native에서 로컬 파일을 읽어 Blob으로 변환
    const response = await fetch(localUri);
    const blob = await response.blob();

    // FormData를 사용하는 대신 Blob을 직접 업로드 (Supabase js SDK 지원)
    const { data, error } = await supabase.storage
      .from(SUPABASE_STORAGE_BUCKETS.PHOTOS)
      .upload(`public/${fileName}`, blob, {
        contentType: 'image/jpeg',
        upsert: true,
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
    console.error('Error uploading photo:', error);
    return null;
  }
};
