import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type NavProp = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseVideo'>;

interface VideoItem {
  id: string;
  title: string;
  duration: string;
  description: string;
  videoId: string;
}

// YouTube ID 출처: parkinson.co.kr "파킨슨병 운동연구소" 공식 채널 (2026년 4월 검증)
const VIDEO_DATA: Record<string, VideoItem[]> = {
  기본: [
    { id: 'b1', title: '자기 전 누워서 하는 하체 스트레칭', duration: '11:22', description: '잠들기 전 침대에서 할 수 있는 하체 스트레칭입니다. 근육 긴장을 풀고 숙면에 도움이 돼요.', videoId: '-qkWVffdId8' },
    { id: 'b2', title: '바른 자세와 상체 스트레칭 1편', duration: '8:57', description: '굽은 자세를 바로잡는 상체 스트레칭입니다. 매일 꾸준히 따라 하면 자세 개선에 효과적이에요.', videoId: '0HuIG3KcYZM' },
    { id: 'b3', title: '뒷다리·어깨·등 스트레칭', duration: '10:41', description: '햄스트링, 어깨, 등을 함께 늘려주는 스트레칭입니다. 몸 뒤쪽 경직 완화에 도움이 돼요.', videoId: '4DyvyJqLKRo' },
    { id: 'b4', title: '굽은 상체 펴기 스트레칭', duration: '10:49', description: '앞으로 굽어있는 상체를 시원하게 펴는 운동입니다. 자세 교정과 호흡 개선에 효과적이에요.', videoId: 'LXhi3nBFZaU' },
    { id: 'b5', title: '파킨슨 걷기 운동과 바른 자세 1편', duration: '5:49', description: '파킨슨 환자에게 중요한 걷기 운동과 바른 자세의 중요성을 설명합니다.', videoId: 'QpOV3uaQD2E' },
    { id: 'b6', title: '발가락 꼬임·통증 완화 운동', duration: '8:06', description: '발가락이 꼬이거나 통증이 있을 때 도움이 되는 운동입니다. 천천히 따라 하세요.', videoId: 'TzW7JHGFo3A' },
    { id: 'b7', title: '보행 동결 극복하기', duration: '12:19', description: '파킨슨 보행 동결(freezing of gait) 증상을 극복하는 방법을 배웁니다.', videoId: 'cBNjrJSq9QA' },
    { id: 'b8', title: '의자에서 하는 상체 스트레칭 2', duration: '7:54', description: '의자에 앉아서 할 수 있는 상체 스트레칭 두 번째 동작입니다. 어깨와 목 긴장 완화에 좋아요.', videoId: 'cIhJTbrwseA' },
    { id: 'b9', title: '파킨슨 걷기 운동과 바른 자세 2편', duration: '6:31', description: '걷기 운동과 바른 자세 교정 두 번째 편입니다. 보행 능력 향상에 도움이 돼요.', videoId: 'cKhZQ9RCzjA' },
    { id: 'b10', title: '의자에서 하는 상체 스트레칭 1', duration: '13:54', description: '의자에 앉아 안전하게 할 수 있는 상체 스트레칭 첫 번째 동작입니다.', videoId: 'f-TFMiyzpGw' },
    { id: 'b11', title: '바른 자세와 상체 스트레칭 2편', duration: '9:01', description: '상체 스트레칭 두 번째 편으로 더 다양한 동작을 배울 수 있어요.', videoId: 'q1L0EiLiMMQ' },
    { id: 'b12', title: '소파에서 하는 골반 스트레칭', duration: '11:36', description: '소파에 앉아 쉽게 따라 할 수 있는 골반 스트레칭입니다. 허리 통증 완화에 도움이 돼요.', videoId: 'swqtpaV7cms' },
    { id: 'b13', title: '척추 마사지·어깨·등 스트레칭', duration: '11:03', description: '척추 마사지와 어깨, 등을 함께 풀어주는 스트레칭입니다. 전체적인 몸 이완에 효과적이에요.', videoId: 'zZ1V1nkcngU' },
  ],
  '1단계': [
    { id: '1a', title: '목·어깨 스트레칭 1단계', duration: '8:20', description: '목과 어깨 근육을 부드럽게 늘려주는 1단계 스트레칭입니다.', videoId: '6ecA2gYmrg8' },
    { id: '1b', title: '허리·장요근 스트레칭 1단계', duration: '8:02', description: '허리와 장요근을 함께 스트레칭하는 1단계 동작입니다. 허리 통증 완화에 도움이 돼요.', videoId: 'Mcacajm0aqk' },
    { id: '1c', title: '오십견 극복 어깨 근력 운동', duration: '8:18', description: '오십견이 있는 분들을 위한 어깨 근력 운동입니다. 천천히 범위를 넓혀가세요.', videoId: 'er9sKQ_Rpl8' },
    { id: '1d', title: '허리 스트레칭 1단계', duration: '7:18', description: '허리 근육을 풀어주는 기본 1단계 스트레칭입니다. 허리 유연성을 높여줘요.', videoId: 'fYXZntKumsI' },
    { id: '1e', title: '햄스트링 스트레칭 1단계', duration: '7:20', description: '허벅지 뒤쪽 햄스트링을 늘려주는 1단계 스트레칭입니다. 걷기 능력 향상에 효과적이에요.', videoId: 'vakbsjHyRH0' },
  ],
  '2단계': [
    { id: '2a', title: '허리 스트레칭 2단계', duration: '9:03', description: '1단계보다 심화된 허리 스트레칭입니다. 더 넓은 범위를 움직여 유연성을 높여요.', videoId: 'Au5G3qrjMHw' },
    { id: '2b', title: '햄스트링 스트레칭 2단계', duration: '7:40', description: '허벅지 뒤쪽을 더 깊이 늘려주는 2단계 스트레칭입니다.', videoId: 'CSo2zkiXoXM' },
    { id: '2c', title: '허리·장요근 스트레칭 2단계', duration: '9:08', description: '허리와 장요근을 더 깊이 스트레칭하는 2단계 동작입니다.', videoId: 'CTdDAUoeLAQ' },
    { id: '2d', title: '어깨 스트레칭 2단계', duration: '5:41', description: '어깨 가동 범위를 넓히는 2단계 스트레칭입니다. 1단계에 익숙해진 후 도전하세요.', videoId: 'EVo_Ma06Izw' },
  ],
  '3단계': [
    { id: '3a', title: '어깨 스트레칭 3단계', duration: '11:32', description: '어깨 유연성을 최대로 높이는 3단계 스트레칭입니다. 충분히 준비된 후 시작하세요.', videoId: 'NzbkVm3sK9o' },
    { id: '3b', title: '허리·장요근 스트레칭 3단계', duration: '8:23', description: '허리와 장요근을 깊이 늘려주는 3단계 고급 스트레칭입니다.', videoId: 'VsbvMj9Y5Bg' },
    { id: '3c', title: '햄스트링 스트레칭 3단계', duration: '10:04', description: '허벅지 뒤쪽을 깊이 늘려주는 3단계 스트레칭입니다.', videoId: 'Wx0hmiaC1xs' },
    { id: '3d', title: '허리 스트레칭 3단계', duration: '11:07', description: '허리 유연성을 극대화하는 3단계 스트레칭입니다. 꾸준히 하면 큰 효과를 볼 수 있어요.', videoId: 'cx1nNxr6d7c' },
  ],
  종합: [
    { id: 't1', title: '말린 어깨 근력 운동', duration: '8:51', description: '안으로 말린 어깨를 바로잡는 근력 운동입니다. 자세 교정과 어깨 통증 완화에 효과적이에요.', videoId: 'CSCpSNe1kjU' },
    { id: 't2', title: '복근 운동으로 균형감각 기르기', duration: '8:50', description: '복근 강화로 균형감각을 키우는 운동입니다. 낙상 예방에 도움이 돼요.', videoId: 'Pc6z4a3taMg' },
    { id: 't3', title: '보행에 필요한 엉덩이 근육 운동', duration: '12:43', description: '걸을 때 필요한 엉덩이 근육을 효과적으로 단련하는 운동입니다.', videoId: 'cO-9YODLHOM' },
    { id: 't4', title: '전신 근력 운동 도전하기', duration: '9:51', description: '전신 근력을 골고루 강화하는 종합 운동입니다. 체력 향상에 효과적이에요.', videoId: 'edkppKSxxZk' },
    { id: 't5', title: '누워서 하는 하체 스트레칭', duration: '12:23', description: '누운 자세로 편하게 할 수 있는 하체 스트레칭입니다. 취침 전 하기 좋아요.', videoId: 'oJh-ZZQuD1M' },
    { id: 't6', title: '의자에서 수시로 하기 좋은 동작', duration: '14:01', description: '의자에 앉아 언제든지 할 수 있는 간단한 운동 동작 모음입니다.', videoId: 'r80TbB72EqM' },
  ],
};

const TABS = ['기본', '1~3단계', '종합'];

function getVideos(tab: string): VideoItem[] {
  if (tab === '1~3단계') {
    return [
      ...VIDEO_DATA['1단계'],
      ...VIDEO_DATA['2단계'],
      ...VIDEO_DATA['3단계'],
    ];
  }
  return VIDEO_DATA[tab] ?? [];
}

export function ExerciseVideoScreen() {
  const navigation = useNavigation<NavProp>();
  const { unreadCount } = useNotificationBadge();
  const [activeTab, setActiveTab] = useState('기본');
  const videos = getVideos(activeTab);

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        title="운동 영상"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      {/* 필터칩 3개 균등 배분 */}
      <View style={styles.tabRow}>
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

      <Text style={styles.sourceText}>영상 출처 : 파킨슨병 운동연구소(parkinson.co.kr)</Text>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.videoCard}
            onPress={() => navigation.navigate('ExerciseVideoPlayer', {
              videoId: item.videoId,
              title: item.title,
              description: item.description,
            })}
            activeOpacity={0.85}
          >
            {/* 썸네일: 카드 내 균등 margin */}
            <View style={styles.thumbnailWrapper}>
              <Image
                source={{ uri: `https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg` }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={20} color="#fff" />
              </View>
            </View>

            <View style={styles.videoInfo}>
              <Text style={styles.videoTitle}>{item.title}</Text>
              <View style={styles.durationRow}>
                <Ionicons name="timer-outline" size={16} color={Colors.textSub} />
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

  /* 탭 영역 */
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  tabBtn: {
    flex: 1,
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

  /* 출처 문구 */
  sourceText: {
    fontSize: 15,
    color: Colors.textSub,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: Colors.background,
    textAlign: 'center',
  },

  /* 리스트 */
  listContent: { paddingTop: 0, paddingHorizontal: 16, paddingBottom: 40 },
  videoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 106,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },

  /* 썸네일 래퍼: margin으로 사방 균등 간격 */
  thumbnailWrapper: {
    marginLeft: 12,
    marginTop: 12,
    marginBottom: 12,
    flexShrink: 0,
  },
  thumbnail: {
    width: 110,
    height: 82,
    borderRadius: 8,
    backgroundColor: Colors.light,
  },
  playOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* 텍스트 영역 */
  videoInfo: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  videoTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  videoDuration: { fontSize: 16, color: Colors.textSub },
  videoDesc: { fontSize: 16, color: '#666666', lineHeight: 22, marginTop: 2 },
});
