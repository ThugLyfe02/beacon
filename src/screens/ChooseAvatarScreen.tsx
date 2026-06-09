import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useAuth } from '../hooks/useAuth';
import { setAvatar3dUrl } from '../services/user.service';

const RPM_URL =
  'https://demo.readyplayer.me/avatar?frameApi&clearCache&bodyType=fullbody';

const INJECT_LISTENER = `
(function() {
  function listen(e) {
    var data = e.data;
    try { if (typeof data === 'string') data = JSON.parse(data); } catch (_) { return; }
    if (!data || data.source !== 'readyplayerme') return;
    window.ReactNativeWebView.postMessage(JSON.stringify(data));
  }
  window.addEventListener('message', listen);
  document.addEventListener('message', listen);
})();
true;
`;

export default function ChooseAvatarScreen() {
  const { user } = useAuth();
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  const [saving, setSaving] = useState(false);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      if (!user?.id) return;
      try {
        const payload = JSON.parse(e.nativeEvent.data) as {
          eventName?: string;
          data?: string | { url?: string };
        };
        if (payload.eventName !== 'v1.avatar.exported') return;
        const url =
          typeof payload.data === 'string'
            ? payload.data
            : payload.data?.url ?? null;
        if (!url) return;
        setSaving(true);
        await setAvatar3dUrl(user.id, url);
        navigation.goBack();
      } catch (err) {
        console.error('[ChooseAvatarScreen] save error', err);
        setSaving(false);
      }
    },
    [user?.id, navigation]
  );

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: RPM_URL }}
        injectedJavaScript={INJECT_LISTENER}
        onMessage={onMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
