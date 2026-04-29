import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';


export function TermsScreen() {
  const navigation = useNavigation<any>();
  const { unreadCount } = useNotificationBadge();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar
        title="이용약관"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <WebView
        style={styles.webview}
        source={{ uri: 'https://parkinon-terms.pages.dev' }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  webview: { flex: 1 },
});
