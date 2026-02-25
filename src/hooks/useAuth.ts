import { useState, useEffect, useRef } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import * as authService from '../services/auth.service';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const verifyingRef = useRef(false);

  useEffect(() => {
    authService.getSession().then(({ session }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        console.log('Auth state changed:', _event, 'user:', !!session?.user);
        setUser(session?.user ?? null);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithOtp = async (email: string) => {
    const { error } = await authService.signInWithOtp(email);
    return { error };
  };

  const verifyOtp = async (email: string, token: string) => {
    if (verifyingRef.current) {
      console.log('useAuth: Already verifying, returning early');
      return { error: null };
    }

    verifyingRef.current = true;
    console.log('useAuth: Starting verification');
    
    const { data, error } = await authService.verifyOtp(email, token);
    
    verifyingRef.current = false;
    
    if (data?.session) {
      console.log('useAuth: Setting user from verification');
      setUser(data.session.user);
    }
    
    return { error };
  };

  const signOut = async () => {
    const { error } = await authService.signOut();
    if (!error) {
      setUser(null);
    }
    return { error };
  };

  return {
    user,
    loading,
    signInWithOtp,
    verifyOtp,
    signOut,
  };
}
