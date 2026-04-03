import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

export function TermsScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="이용약관" showBack />
      <WebView
        style={styles.webview}
        source={require('../../../docs/terms.html')}
        originWhitelist={['*']}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  webview: { flex: 1 },
});
