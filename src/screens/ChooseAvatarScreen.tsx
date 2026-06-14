import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { setAvatar3dUrl } from '../services/user.service';

// Configure ONE of these:
//   EXPO_PUBLIC_AVATURN_URL   = direct iframe URL from your dev subdomain
//                               (e.g. https://<sub>.avaturn.dev). Skip the
//                               edge function — easiest for prototyping.
//   AVATURN_API_KEY (server)  = use the avaturn-session edge function which
//                               mints a session URL via /v1/sessions/new.
const DIRECT_AVATURN_URL = process.env.EXPO_PUBLIC_AVATURN_URL ?? null;

const INJECT_LISTENER = `
(function() {
  function listen(e) {
    var d = e.data;
    try { if (typeof d === 'string') d = JSON.parse(d); } catch (_) { return; }
    if (!d || typeof d !== 'object') return;

    // Avaturn (v1.avaturn-sdk-server / eventName 'export_avatar')
    if (d.source === 'v1.avaturn-sdk-server' && d.eventName === 'export_avatar') {
      var url = d.data && d.data.url;
      if (url) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ provider: 'avaturn', url: url }));
        return;
      }
    }

    // Legacy Ready Player Me — in case RPM comes back online.
    if (d.source === 'readyplayerme' && d.eventName === 'v1.avatar.exported') {
      var rpmUrl = typeof d.data === 'string' ? d.data : (d.data && d.data.url);
      if (rpmUrl) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ provider: 'rpm', url: rpmUrl }));
        return;
      }
    }
  }
  window.addEventListener('message', listen);
  document.addEventListener('message', listen);
})();
true;
`;

export default function ChooseAvatarScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [sessionUrl, setSessionUrl] = useState<string | null>(DIRECT_AVATURN_URL);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (DIRECT_AVATURN_URL) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{ url: string }>(
          'avaturn-session'
        );
        if (cancelled) return;
        if (error || !data?.url) {
          setLoadError(error?.message ?? 'Could not start avatar session.');
        } else {
          setSessionUrl(data.url);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not start avatar session.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      if (!user?.id) return;
      try {
        const payload = JSON.parse(e.nativeEvent.data) as { url?: string };
        if (!payload.url) return;
        setSaving(true);
        await setAvatar3dUrl(user.id, payload.url);
        navigation.goBack();
      } catch (err) {
        console.error('[ChooseAvatarScreen] save error', err);
        setSaving(false);
      }
    },
    [user?.id, navigation]
  );

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Avatar service unavailable</Text>
        <Text style={styles.body}>{loadError}</Text>
        <Text style={styles.hint}>
          Set EXPO_PUBLIC_AVATURN_URL in .env (direct subdomain) or deploy the
          avaturn-session edge function with AVATURN_API_KEY.
        </Text>
      </View>
    );
  }

  if (!sessionUrl) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f59e0b" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: sessionUrl }}
        injectedJavaScript={INJECT_LISTENER}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
      />
      {saving && (
        <View style={styles.overlay}>
          <ActivityIndicator color="#f59e0b" size="large" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#f5f5f5', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { color: '#9ca3af', textAlign: 'center', fontSize: 14 },
  hint: { color: '#6b7280', textAlign: 'center', fontSize: 12, marginTop: 8 },
});
