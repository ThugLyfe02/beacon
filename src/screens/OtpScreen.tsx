import React, { useState, useRef, useEffect } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import {
  GlowButton,
  GlowInput,
  GridBackground,
  Loader,
  NeonText,
  Pill,
} from '../components/ui';
import { palette, spacing } from '../theme';

export function OtpScreen() {
  const { signInWithOtp, verifyOtp, user } = useAuth();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (user) {
      console.log('User authenticated, OTP flow complete');
    }
  }, [user]);

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert('Hold up', 'Enter your email to continue.');
      return;
    }
    setLoading(true);
    const { error } = await signInWithOtp(email);
    setLoading(false);
    if (error) {
      Alert.alert('Could not send code', error.message);
      return;
    }
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    if (verifyingRef.current || verified) return;
    const trimmedOtp = otp.trim();
    if (!trimmedOtp) {
      Alert.alert('Hold up', 'Enter the 6-digit code.');
      return;
    }
    verifyingRef.current = true;
    setLoading(true);
    const { error } = await verifyOtp(email, trimmedOtp);
    setLoading(false);
    if (error) {
      verifyingRef.current = false;
      Alert.alert('Verification failed', error.message);
      return;
    }
    setVerified(true);
  };

  if (verified || user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <GridBackground />
        <View style={styles.signingIn}>
          <Loader size={64} />
          <NeonText variant="label" tone="accent" style={{ marginTop: spacing.lg }}>
            Establishing signal
          </NeonText>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <GridBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.brand}>
              <Pill label="Beta · v0" tone="accent" dot />
              <NeonText variant="display" tone="accent" glow style={styles.wordmark}>
                BEACON
              </NeonText>
              <NeonText variant="bodyMuted" style={styles.tagline}>
                Signal-grade networking{'\n'}for the people in the room.
              </NeonText>
            </View>

            <View style={styles.form}>
              {step === 'email' ? (
                <>
                  <GlowInput
                    label="Identity"
                    placeholder="you@domain.com"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                  />
                  <GlowButton
                    label="Send access code"
                    onPress={handleSendOtp}
                    loading={loading}
                    fullWidth
                    size="lg"
                  />
                </>
              ) : (
                <>
                  <View style={styles.codeHeader}>
                    <NeonText variant="label" tone="accent">
                      Code sent to
                    </NeonText>
                    <NeonText variant="mono" tone="text" glow>
                      {email.trim().toLowerCase()}
                    </NeonText>
                  </View>
                  <GlowInput
                    label="6-digit access code"
                    placeholder="• • • • • •"
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={styles.codeInput}
                  />
                  <GlowButton
                    label="Verify & enter"
                    onPress={handleVerifyOtp}
                    loading={loading}
                    fullWidth
                    size="lg"
                  />
                  <Pressable
                    onPress={() => {
                      setStep('email');
                      setOtp('');
                      setVerified(false);
                      verifyingRef.current = false;
                    }}
                    style={styles.linkRow}
                  >
                    <NeonText variant="label" tone="muted">
                      ← use a different email
                    </NeonText>
                  </Pressable>
                </>
              )}
            </View>

            <View style={styles.footer}>
              <NeonText variant="label" tone="dim">
                privacy first · no passwords · no spam
              </NeonText>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.void },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
  },
  brand: { alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.xl },
  wordmark: { fontSize: 48, letterSpacing: 4, fontWeight: '900' },
  tagline: { marginTop: spacing.sm, lineHeight: 22 },
  form: { gap: spacing.lg, marginTop: spacing.xxl },
  codeHeader: { gap: spacing.xs, marginBottom: spacing.xs },
  codeInput: {
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '600',
  },
  linkRow: { alignSelf: 'center', paddingVertical: spacing.md },
  footer: { alignItems: 'center', paddingTop: spacing.xl },
  signingIn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
