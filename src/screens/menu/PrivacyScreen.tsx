import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

export function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="개인정보처리방침" showBack />
      <WebView
        style={styles.webview}
        source={require('../../../docs/privacy.html')}
        originWhitelist={['*']}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  webview: { flex: 1 },
});
