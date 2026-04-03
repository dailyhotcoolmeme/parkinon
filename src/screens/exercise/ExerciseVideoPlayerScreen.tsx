import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { WebView } from 'react-native-webview';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';

type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseVideoPlayer'>['route'];

const SCREEN_WIDTH = Dimensions.get('window').width;
const VIDEO_HEIGHT = Math.round(SCREEN_WIDTH * 9 / 16);

function makePlayerHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; width: 100%; height: 100%; }
    #player { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    function onYouTubeIframeAPIReady() {
      new YT.Player('player', {
        videoId: '${videoId}',
        playerVars: {
          autoplay: 0,
          playsinline: 1,
          controls: 1,
          rel: 0,
          modestbranding: 1,
        },
        height: '100%',
        width: '100%',
      });
    }
  </script>
</body>
</html>`;
}

export function ExerciseVideoPlayerScreen() {
  const route = useRoute<RouteProps>();
  const { videoId, title, description } = route.params;
  const [loading, setLoading] = useState(true);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={title} showBack />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 영상 영역 */}
        <View style={[styles.playerContainer, { height: VIDEO_HEIGHT }]}>
          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}
          <WebView
            style={{ flex: 1 }}
            source={{ html: makePlayerHtml(videoId) }}
            javaScriptEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            onLoad={() => setLoading(false)}
            onError={() => setLoading(false)}
            scrollEnabled={false}
            bounces={false}
            originWhitelist={['*']}
          />
        </View>

        {/* 운동 정보 */}
        <View style={styles.infoArea}>
          <Text style={styles.infoTitle}>{title}</Text>
          <View style={styles.descCard}>
            <Text style={styles.descLabel}>운동 소개</Text>
            <Text style={styles.descText}>{description}</Text>
          </View>
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>💡 운동 전 주의사항</Text>
            <Text style={styles.tipItem}>• 운동 전 충분히 스트레칭 하세요</Text>
            <Text style={styles.tipItem}>• 몸 상태가 좋지 않으면 쉬어 가세요</Text>
            <Text style={styles.tipItem}>• 의자나 벽을 잡고 안전하게 진행하세요</Text>
            <Text style={styles.tipItem}>• 통증이 느껴지면 즉시 멈추세요</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  playerContainer: {
    width: SCREEN_WIDTH,
    backgroundColor: '#000',
    position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    zIndex: 10,
  },
  infoArea: {
    padding: 20,
    gap: 16,
    paddingBottom: 48,
  },
  infoTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  descCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  descLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    marginBottom: 8,
  },
  descText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 28,
  },
  tipCard: {
    backgroundColor: '#FFF9E6',
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  tipTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 4,
  },
  tipItem: {
    fontSize: 17,
    color: '#78350F',
    lineHeight: 26,
  },
});
