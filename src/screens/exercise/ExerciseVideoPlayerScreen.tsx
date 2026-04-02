import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';

type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseVideoPlayer'>['route'];

const { width } = Dimensions.get('window');
const VIDEO_HEIGHT = Math.round(width * (9 / 16));

export function ExerciseVideoPlayerScreen() {
  const route = useRoute<RouteProps>();
  const { videoId, title, description } = route.params;

  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="운동 영상" showBack />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 유튜브 플레이어 */}
        <View style={[styles.playerContainer, { height: VIDEO_HEIGHT }]}>
          <WebView
            source={{ uri: embedUrl }}
            style={styles.webView}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
          />
        </View>

        {/* 영상 정보 */}
        <View style={styles.infoSection}>
          <Text style={styles.videoTitle}>{title}</Text>
          <View style={styles.divider} />
          <Text style={styles.description}>{description}</Text>

          <View style={styles.tipCard}>
            <View style={styles.tipTitleRow}>
              <Ionicons name="bulb-outline" size={18} color={Colors.dark} />
              <Text style={styles.tipTitle}>운동 시 주의사항</Text>
            </View>
            <Text style={styles.tipText}>
              • 무리하지 마세요. 몸이 힘들면 잠깐 쉬어도 돼요.{'\n'}
              • 넘어지지 않도록 안전한 공간에서 해주세요.{'\n'}
              • 운동 후 물을 충분히 드세요.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  playerContainer: {
    width: '100%',
    backgroundColor: '#000',
  },
  webView: { flex: 1, backgroundColor: '#000' },
  infoSection: { padding: 20 },
  videoTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 12,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 24,
    marginBottom: 20,
  },
  tipCard: {
    backgroundColor: Colors.light,
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  tipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark,
  },
  tipText: {
    fontSize: 16,
    color: Colors.text,
    lineHeight: 26,
  },
});
