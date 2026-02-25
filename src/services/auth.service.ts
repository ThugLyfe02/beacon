// =============================================================================
// Beacon MVP — Auth Service
// auth_method: otp
// =============================================================================
import { Session, User, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Send a one-time password (OTP) to the provided email address.
 * auth_method = "otp": uses signInWithOtp without magic link redirect.
 */
export async function signInWithOtp(email: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: true,
    },
  });
  return { error };
}

/**
 * Verify the OTP token the user received via email.
 * Only included when auth_method = "otp".
 */
export async function verifyOtp(
  email: string,
  token: string
): Promise<VerifyOtpResult> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
  return { data, error };
}

/**
 * Retrieve the current session and user from the Supabase client.
 */
export async function getSession(): Promise<SessionResult> {
  const { data, error } = await supabase.auth.getSession();
  return {
    session: data.session,
    user: data.session?.user ?? null,
    error,
  };
}

/**
 * Sign the current user out and clear the local session.
 */
export async function signOut(): Promise<SignOutResult> {
  const { error } = await supabase.auth.signOut();
  return { error };
}
