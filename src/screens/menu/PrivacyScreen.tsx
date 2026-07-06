import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { isOverseasLocale } from '../../i18n/detectLocale';


export function PrivacyScreen() {
  const navigation = useNavigation<any>();
  const { unreadCount } = useNotificationBadge();
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('legalDocs.privacyTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <WebView
        style={styles.webview}
        source={{ uri: isOverseasLocale() ? 'https://parkinon.com/privacy/en' : 'https://parkinon.com/privacy' }}
        originWhitelist={['https://parkinon.com']}
        // 신뢰 도메인 외부로의 이탈 차단 — 외부 링크는 차단(필요 시 외부 브라우저로만)
        onShouldStartLoadWithRequest={(req) =>
          req.url.startsWith('https://parkinon.com')
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  webview: { flex: 1 },
});
