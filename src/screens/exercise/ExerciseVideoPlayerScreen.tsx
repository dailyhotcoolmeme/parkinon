import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import YoutubePlayer from 'react-native-youtube-iframe';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseVideoPlayer'>['route'];

const SCREEN_WIDTH = Dimensions.get('window').width;
const VIDEO_HEIGHT = Math.round(SCREEN_WIDTH * 9 / 16);

export function ExerciseVideoPlayerScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<any>();
  const { videoId, title, description } = route.params;
  const { unreadCount } = useNotificationBadge();

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const openInYoutube = () => {
    Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        title=""
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* 영상 영역 */}
        <View style={[styles.playerContainer, { minHeight: VIDEO_HEIGHT }]}>
          {loading && !error && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          )}

          {!error ? (
            <YoutubePlayer
              height={VIDEO_HEIGHT}
              videoId={videoId}
              play={playing}
              onReady={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(true);
              }}
              onChangeState={(state: string) => {
                if (state === 'ended') setPlaying(false);
              }}
              initialPlayerParams={{
                preventFullScreen: false,
                controls: true,
                modestbranding: true,
                rel: false,
              }}
            />
          ) : (
            /* 에러 시 fallback */
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>영상을 불러올 수 없어요</Text>
              <TouchableOpacity style={styles.youtubeBtn} onPress={openInYoutube}>
                <Text style={styles.youtubeBtnText}>▶ 유튜브로 보기</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 운동 정보 */}
        <View style={styles.infoArea}>
          <Text style={styles.infoTitle}>{title}</Text>
          <View style={styles.descCard}>
            <View style={styles.descLabelRow}>
              <Ionicons name="fitness" size={24} color={Colors.primary} />
              <Text style={styles.descLabel}>운동 소개</Text>
            </View>
            <Text style={styles.descText}>{description}</Text>
          </View>
          <View style={styles.tipCard}>
            <View style={styles.tipTitleRow}>
              <Ionicons name="alert-circle" size={24} color="#B45309" />
              <Text style={styles.tipTitle}> 운동 전 주의사항</Text>
            </View>
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
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
    zIndex: 10,
  },
  errorBox: {
    minHeight: VIDEO_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: '#111',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#fff',
  },
  youtubeBtn: {
    backgroundColor: '#FF0000',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  youtubeBtnText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '700',
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
  descLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  descLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
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
  tipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  tipTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#B45309',
  },
  tipItem: {
    fontSize: 17,
    color: '#78350F',
    lineHeight: 26,
  },
});
