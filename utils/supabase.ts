import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const SUPABASE_TABLES = {
  SESSIONS: 'sessions',
  LOCATIONS: 'locations',
  PHOTOS: 'photos',
  HIKE_SESSIONS: 'hike_sessions',
} as const;

export const SUPABASE_STORAGE_BUCKETS = {
  PHOTOS: 'photos',
  AVATARS: 'avatars',
} as const;

if (!supabaseUrl || !supabaseAnonKey) {
  const message = '[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.';
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(message);
  }
  console.error(message);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // React Native에서는 기본적으로 false
  },
});
