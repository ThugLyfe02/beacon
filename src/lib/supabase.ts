import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log('Supabase client initialised with URL:', supabaseUrl);
}

/**
 * The repository's handwritten Database interface predates the current Supabase
 * generated-type contract and caused every table mutation/RPC argument to infer
 * as `never`. Keep domain types at service boundaries and regenerate the client
 * schema with the Supabase CLI before restoring createClient<Database>().
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
