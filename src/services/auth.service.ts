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
  } else {
    console.log('auth.service: OTP verified successfully!');
  }
  
  return { data, error };
}

export async function getSession(): Promise<SessionResult> {
  const { data, error } = await supabase.auth.getSession();
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
