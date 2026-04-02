import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseVideo'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface VideoItem {
  id: string;
  title: string;
  duration: string;
  videoId: string;
  iconLib: 'MCI' | 'Ionicons';
  iconName: MCIName | IoniconName;
}

const VIDEO_DATA: Record<string, VideoItem[]> = {
  기본: [
    { id: '1', title: '스트레칭 기본 1', duration: '5분 30초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'yoga' },
    { id: '2', title: '균형 운동 기본', duration: '8분 20초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'scale-outline' },
    { id: '3', title: '걷기 준비 운동', duration: '4분 10초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'walk' },
  ],
  '1단계': [
    { id: '4', title: '균형 운동 1단계', duration: '10분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'scale-outline' },
    { id: '5', title: '근력 운동 1단계', duration: '12분 30초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'dumbbell' },
    { id: '6', title: '스트레칭 1단계', duration: '7분 45초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'body-outline' },
  ],
  '2단계': [
    { id: '7', title: '균형 운동 2단계', duration: '14분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'scale-outline' },
    { id: '8', title: '근력 운동 2단계', duration: '15분 20초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'dumbbell' },
    { id: '9', title: '걷기 2단계', duration: '20분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'walk' },
  ],
  '3단계': [
    { id: '10', title: '종합 체력 3단계', duration: '20분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'MCI', iconName: 'run' },
    { id: '11', title: '균형 운동 3단계', duration: '18분 30초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'scale-outline' },
  ],
  종합: [
    { id: '12', title: '파킨슨 종합 운동', duration: '30분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'trophy-outline' },
    { id: '13', title: '일상 활동 종합', duration: '25분 00초', videoId: 'dQw4w9WgXcQ', iconLib: 'Ionicons', iconName: 'star-outline' },
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
  const navigation = useNavigation<Nav>();
  const [activeTab, setActiveTab] = useState('기본');
  const videos = VIDEO_DATA[activeTab] ?? [];

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar title="운동 영상" showBack />

      {/* 탭 */}
      <View style={styles.tabRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
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
        </ScrollView>
      </View>

      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.videoCard}
            onPress={() =>
              navigation.navigate('ExerciseVideoPlayer', {
                videoId: item.videoId,
                title: item.title,
                description: `파킨슨 환자를 위한 ${activeTab} 운동 영상입니다. 천천히 따라해 보세요.`,
              })
            }
            activeOpacity={0.85}
          >
            <View style={styles.thumbnail}>
              <VideoThumbnailIcon item={item} />
              <View style={styles.playOverlay}>
                <Ionicons name="play" size={10} color={Colors.white} />
              </View>
            </View>
            <View style={styles.videoInfo}>
              <Text style={styles.videoTitle}>{item.title}</Text>
              <View style={styles.durationRow}>
                <Ionicons name="timer-outline" size={14} color={Colors.textSub} />
                <Text style={styles.videoDuration}>{item.duration}</Text>
              </View>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    marginRight: 8,
  },
  tabBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  tabLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  tabLabelActive: { color: Colors.white },
  listContent: { padding: 16, paddingBottom: 40 },
  videoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  thumbnail: {
    width: 100,
    height: 80,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoInfo: { flex: 1, padding: 16 },
  videoTitle: { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  durationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  videoDuration: { fontSize: 14, color: Colors.textSub },
});
