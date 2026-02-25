import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database';

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Helpful in dev to confirm we're hitting the right project.
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('Supabase client initialised with URL:', supabaseUrl);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
