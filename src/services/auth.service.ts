import { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface SignInResult {
  error: AuthError | null;
}

export interface VerifyOtpResult {
  data: { session: Session | null; user: User | null } | null;
  error: AuthError | null;
}

export interface SessionResult {
  session: Session | null;
  user: User | null;
  error: AuthError | null;
}

export interface SignOutResult {
  error: AuthError | null;
}

export async function signInWithOtp(email: string): Promise<SignInResult> {
  console.log('Sending OTP to:', email);
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error('signInWithOtp error:', error);
  } else {
    console.log('OTP sent successfully');
  }
  
  return { error };
}

export async function verifyOtp(
  email: string,
  token: string
): Promise<VerifyOtpResult> {
  console.log('auth.service: Verifying OTP for:', email);

  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });

  if (error) {
    console.error('auth.service: verifyOtp error:', error.message);
    return { data, error };
  }

  console.log('auth.service: OTP verified successfully!');

  // Create user row in public.users table (only after successful OTP verification)
  if (data.user) {
    await ensureUserExists(data.user.id, data.user.email!);
  }

  return { data, error };
}

/**
 * Ensure user exists in public.users table
 * This is called after OTP verification to create the user row
 */
async function ensureUserExists(userId: string, email: string): Promise<void> {
  console.log('[auth.service] ensureUserExists called for:', { userId, email });

  try {
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        email: email,
      })
      .select()
      .single();

    if (error) {
      // Ignore duplicate key error (user already exists)
      if (error.code === '23505') {
        console.log('[auth.service] User already exists in database:', userId);
      } else {
        console.error('[auth.service] Failed to create user row:', error);
        console.error('[auth.service] Error code:', error.code);
        console.error('[auth.service] Error message:', error.message);
      }
    } else {
      console.log('[auth.service] User row created successfully:', data);
    }
  } catch (err) {
    console.error('[auth.service] Exception in ensureUserExists:', err);
  }
}

export async function getSession(): Promise<SessionResult> {
  const { data, error } = await supabase.auth.getSession();

  // Ensure user exists in public.users table when restoring session
  if (data.session?.user) {
    await ensureUserExists(data.session.user.id, data.session.user.email!);
  }

  return {
    session: data.session,
    user: data.session?.user ?? null,
    error,
  };
}

export async function signOut(): Promise<SignOutResult> {
  const { error } = await supabase.auth.signOut();
  return { error };
}
