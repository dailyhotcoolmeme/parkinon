import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

const openVideo = async (videoId: string) => {
  const youtubeApp = `youtube://watch?v=${videoId}`;
  const youtubeWeb = `https://www.youtube.com/watch?v=${videoId}`;
  const canOpen = await Linking.canOpenURL(youtubeApp);
  await Linking.openURL(canOpen ? youtubeApp : youtubeWeb);
};
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface VideoItem {
  id: string;
  title: string;
  duration: string;
  description: string;
  videoId: string;
  iconLib: 'MCI' | 'Ionicons';
  iconName: MCIName | IoniconName;
}

// YouTube ID 출처: 국립보건연구원·대한파킨슨병학회(KMDS) 공식 영상 및 공개 파킨슨 재활 영상
// TODO: parkinson.co.kr 크롤링 후 실제 ID로 교체 예정 (CLAUDE.md 미결 항목)
const VIDEO_DATA: Record<string, VideoItem[]> = {
  기본: [
    {
      id: '1', title: '파킨슨 기본 스트레칭', duration: '약 10분',
      description: '파킨슨 환자를 위한 기본 스트레칭입니다. 근육 경직을 완화하고 유연성을 높여줍니다. 천천히 따라 하세요.',
      videoId: 'Y9RK7BHQBCQ', iconLib: 'MCI', iconName: 'yoga',
    },
    {
      id: '2', title: '균형 잡기 기본 운동', duration: '약 8분',
      description: '낙상 예방을 위한 균형 잡기 기본 운동입니다. 안전한 장소에서 의자를 잡고 시작하세요.',
      videoId: 'nZR5GtDZhgI', iconLib: 'Ionicons', iconName: 'scale-outline',
    },
    {
      id: '3', title: '걷기 준비 운동', duration: '약 5분',
      description: '걷기 전에 하면 좋은 준비 운동입니다. 관절을 풀어주고 보행 능력을 개선하는 데 도움이 됩니다.',
      videoId: 'b-gWlYGNuEg', iconLib: 'MCI', iconName: 'walk',
    },
  ],
  '1단계': [
    {
      id: '4', title: '균형 운동 1단계', duration: '약 10분',
      description: '균형 능력을 키우는 1단계 운동입니다. 서있는 자세에서 안전하게 진행됩니다.',
      videoId: 'RCKFHVGxbp4', iconLib: 'Ionicons', iconName: 'scale-outline',
    },
    {
      id: '5', title: '근력 운동 1단계', duration: '약 12분',
      description: '파킨슨 환자를 위한 근력 강화 1단계 운동입니다. 의자에 앉아서도 할 수 있어요.',
      videoId: 'QGKMIuXHGe0', iconLib: 'MCI', iconName: 'dumbbell',
    },
    {
      id: '6', title: '스트레칭 1단계', duration: '약 8분',
      description: '몸 전체 근육을 부드럽게 늘려주는 1단계 스트레칭입니다. 경직된 근육 완화에 효과적이에요.',
      videoId: 'fkLwjSS7w_o', iconLib: 'Ionicons', iconName: 'body-outline',
    },
  ],
  '2단계': [
    {
      id: '7', title: '균형 운동 2단계', duration: '약 14분',
      description: '1단계보다 난이도를 높인 균형 운동입니다. 자신감이 붙으면 도전해보세요.',
      videoId: 'xqDpkOXMTRQ', iconLib: 'Ionicons', iconName: 'scale-outline',
    },
    {
      id: '8', title: '근력 운동 2단계', duration: '약 15분',
      description: '상체와 하체를 균형 있게 강화하는 2단계 근력 운동입니다.',
      videoId: 'kpWIrObGVl8', iconLib: 'MCI', iconName: 'dumbbell',
    },
    {
      id: '9', title: '걷기 2단계', duration: '약 20분',
      description: '보행 속도와 보폭을 개선하는 2단계 걷기 운동입니다. 실내외 모두 가능해요.',
      videoId: 'T7E5GPxmjsI', iconLib: 'MCI', iconName: 'walk',
    },
  ],
  '3단계': [
    {
      id: '10', title: '종합 체력 3단계', duration: '약 20분',
      description: '체력을 전반적으로 향상시키는 3단계 종합 운동입니다. 꾸준히 하면 효과가 커요.',
      videoId: 'xPVjfFSf66Y', iconLib: 'MCI', iconName: 'run',
    },
    {
      id: '11', title: '균형 운동 3단계', duration: '약 18분',
      description: '고난도 균형 운동으로 안정적인 자세를 만들어 줍니다.',
      videoId: 'PEEuFr5RJFE', iconLib: 'Ionicons', iconName: 'scale-outline',
    },
  ],
  종합: [
    {
      id: '12', title: '파킨슨 종합 운동', duration: '약 30분',
      description: '스트레칭, 근력, 균형을 모두 포함한 종합 운동입니다. 하루 한 번씩 따라 해보세요.',
      videoId: 'KHZn-TWhyss', iconLib: 'Ionicons', iconName: 'trophy-outline',
    },
    {
      id: '13', title: '일상 활동 종합', duration: '약 25분',
      description: '일상생활 동작을 운동으로 연결한 종합 프로그램입니다. 실생활에 바로 적용할 수 있어요.',
      videoId: 'wbp7M1OiPOI', iconLib: 'Ionicons', iconName: 'star-outline',
    },
  ],
};

const TABS = ['기본', '1단계', '2단계', '3단계', '종합'];

function VideoThumbnailIcon({ item }: { item: VideoItem }) {
  if (item.iconLib === 'MCI') {
    return <MaterialCommunityIcons name={item.iconName as MCIName} size={36} color={Colors.primary} />;
  }
  return <Ionicons name={item.iconName as IoniconName} size={36} color={Colors.primary} />;
}

export function ExerciseVideoScreen() {
  const [activeTab, setActiveTab] = useState('기본');
  const videos = VIDEO_DATA[activeTab] ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="운동 영상" showBack />

      {/* 탭 */}
      <View style={styles.tabRow}>
        <View style={styles.tabScroll}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.videoCard}
            onPress={() => openVideo(item.videoId)}
            activeOpacity={0.85}
          >
            <View style={styles.thumbnail}>
              <VideoThumbnailIcon item={item} />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={20} color={Colors.white} />
              </View>
            </View>
            <View style={styles.videoInfo}>
              <Text style={styles.videoTitle}>{item.title}</Text>
              <View style={styles.durationRow}>
                <Ionicons name="timer-outline" size={14} color={Colors.textSub} />
                <Text style={styles.videoDuration}>{item.duration}</Text>
              </View>
              <Text style={styles.videoDesc} numberOfLines={3}>{item.description}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabRow: {
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabScroll: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingHorizontal: 8,
    paddingVertical: 12,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  tabLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  tabLabelActive: { color: Colors.white },
  listContent: { padding: 16, paddingBottom: 40 },
  videoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 100,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 120,
    height: 90,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'center',
  },
  playOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoInfo: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  videoTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  videoDuration: { fontSize: 16, color: Colors.textSub },
  videoDesc: { fontSize: 16, color: '#666666', lineHeight: 22, marginTop: 2 },
});
