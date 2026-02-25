import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';

export function OtpScreen() {
  const { signInWithOtp, verifyOtp, user } = useAuth();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const verifyingRef = useRef(false);

  // Don't allow verification if already verified or user is authenticated
  useEffect(() => {
    if (user) {
      console.log('User authenticated, OTP flow complete');
    }
  }, [user]);

  const handleSendOtp = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }

    setLoading(true);
    console.log('Requesting OTP for email:', email.trim().toLowerCase());
    const { error } = await signInWithOtp(email);
    setLoading(false);

    if (error) {
      console.error('Send OTP error:', error);
      Alert.alert('Error', error.message);
      return;
    }

    console.log('OTP request successful, moving to verification step');
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    // Prevent duplicate calls
    if (verifyingRef.current || verified) {
      console.log('Already verifying or verified, skipping');
      return;
    }

    const trimmedOtp = otp.trim();
    
    if (!trimmedOtp) {
      Alert.alert('Error', 'Please enter the 6-digit code');
      return;
    }

    console.log('Verifying OTP:', {
      email: email.trim().toLowerCase(),
      token: trimmedOtp,
      tokenLength: trimmedOtp.length,
    });

    verifyingRef.current = true;
    setLoading(true);
    
    const { error } = await verifyOtp(email, trimmedOtp);
    
    setLoading(false);

    if (error) {
      verifyingRef.current = false;
      console.error('Verify OTP error:', error);
      Alert.alert('Verification Failed', error.message);
      return;
    }

    console.log('OTP verified successfully!');
    setVerified(true);
    // Don't reset verifyingRef - keep it locked to prevent duplicate calls
    // Navigation will be handled automatically by RootNavigator
  };

  if (verified || user) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" />
        <Text style={styles.subtitle}>Signing you in...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Beacon</Text>
      <Text style={styles.subtitle}>Privacy-first professional networking</Text>

      {step === 'email' ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.button, loading ? styles.buttonDisabled : null]}
            onPress={handleSendOtp}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Send Code</Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.instruction}>
            Enter the 6-digit code sent to{'\n'}
            <Text style={styles.emailBold}>{email}</Text>
          </Text>

          <TextInput
            style={styles.input}
            placeholder="000000"
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            maxLength={6}
          />

          <TouchableOpacity
            style={[styles.button, loading ? styles.buttonDisabled : null]}
            onPress={handleVerifyOtp}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Verify</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => {
              setStep('email');
              setOtp('');
              setVerified(false);
              verifyingRef.current = false;
            }} 
            activeOpacity={0.7}
          >
            <Text style={styles.linkText}>Use a different email</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 40,
  },
  instruction: {
    fontSize: 14,
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  emailBold: {
    fontWeight: '600',
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#999',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  linkText: {
    marginTop: 16,
    color: '#007AFF',
    fontSize: 14,
  },
});
