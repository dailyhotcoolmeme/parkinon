import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<FeedStackParamList, 'FeedMain'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface PostItem {
  id: string;
  isNews: boolean;
  category: string;
  categoryIcon: IoniconName;
  author: string;
  date: string;
  views: number;
  title: string;
  preview: string;
  thumbnail?: string;
  commentCount: number;
  likeCount: number;
}

const DUMMY_POSTS: PostItem[] = [
  {
    id: '1',
    isNews: false,
    category: '자유수다',
    categoryIcon: 'chatbubble-outline',
    author: '홍길동',
    date: '3월 30일',
    views: 24,
    title: '파킨슨 약 복용 관리가 너무 어려워요...',
    preview: '매일 여러 번 약을 챙겨 드셔야 하는데 자꾸 까먹게 되더라고요. 혹시 좋은 방법 있으신 분 계세요?',
    thumbnail: '💊',
    commentCount: 3,
    likeCount: 5,
  },
  {
    id: '2',
    isNews: true,
    category: '뉴스',
    categoryIcon: 'newspaper-outline',
    author: '파킨슨 뉴스',
    date: '3월 29일',
    views: 152,
    title: '파킨슨병 새 치료법 연구 결과 발표',
    preview: '국내 연구팀이 파킨슨병 증상 완화에 효과적인 새로운 치료 접근법을 발표했습니다.',
    thumbnail: '🔬',
    commentCount: 0,
    likeCount: 12,
  },
  {
    id: '3',
    isNews: false,
    category: '질문있어요',
    categoryIcon: 'help-circle-outline',
    author: '김영희',
    date: '3월 29일',
    views: 35,
    title: '균형 운동 어떻게 시작하면 좋을까요?',
    preview: '처음 진단을 받고 운동을 시작해보려는데 어떤 운동부터 시작하면 좋을지 모르겠어요.',
    commentCount: 7,
    likeCount: 3,
  },
  {
    id: '4',
    isNews: false,
    category: '정보공유',
    categoryIcon: 'megaphone-outline',
    author: '이정수',
    date: '3월 28일',
    views: 88,
    title: '파킨슨 재활 센터 추천 목록 (서울)',
    preview: '서울에 있는 파킨슨 재활 전문 센터 리스트 공유드립니다.',
    commentCount: 4,
    likeCount: 21,
  },
  {
    id: '5',
    isNews: false,
    category: '운동인증',
    categoryIcon: 'fitness-outline',
    author: '박민준',
    date: '3월 28일',
    views: 42,
    title: '오늘도 걷기 30분 완료했어요!',
    preview: '날씨도 좋고 몸 상태도 4점이어서 공원 한 바퀴 돌았습니다. 같이 힘내요!',
    thumbnail: '🌳',
    commentCount: 9,
    likeCount: 18,
  },
  {
    id: '6',
    isNews: true,
    category: '뉴스',
    categoryIcon: 'newspaper-outline',
    author: '파킨슨 뉴스',
    date: '3월 27일',
    views: 203,
    title: '파킨슨병 환자 운동 효과, 임상 연구로 입증',
    preview: '규칙적인 운동이 파킨슨병 진행 속도를 늦출 수 있다는 연구 결과가 발표되었습니다.',
    commentCount: 0,
    likeCount: 34,
  },
  {
    id: '7',
    isNews: false,
    category: '응원해요',
    categoryIcon: 'heart-circle-outline',
    author: '최선우',
    date: '3월 27일',
    views: 19,
    title: '힘드시죠? 함께 이겨내요 💚',
    preview: '아버지가 진단받으신 지 2년이 됐어요. 힘드신 분들 모두 응원합니다.',
    commentCount: 6,
    likeCount: 27,
  },
  {
    id: '8',
    isNews: false,
    category: '자유수다',
    categoryIcon: 'chatbubble-outline',
    author: '강미연',
    date: '3월 26일',
    views: 67,
    title: '오늘 병원에서 좋은 소식 들었어요',
    preview: '정기검진에서 작년보다 상태가 안정적이라고 하셨어요. 꾸준히 관리한 보람이 있네요!',
    commentCount: 12,
    likeCount: 45,
  },
  {
    id: '9',
    isNews: false,
    category: '질문있어요',
    categoryIcon: 'help-circle-outline',
    author: '정해영',
    date: '3월 25일',
    views: 31,
    title: '약 먹고 나서 졸린 게 정상인가요?',
    preview: '오전 약을 먹고 나면 너무 졸려서 일상생활이 힘들어요. 비슷한 경험 있으신 분?',
    commentCount: 5,
    likeCount: 8,
  },
  {
    id: '10',
    isNews: false,
    category: '정보공유',
    categoryIcon: 'megaphone-outline',
    author: '한소희',
    date: '3월 24일',
    views: 114,
    title: '파킨슨 환우회 정기 모임 안내',
    preview: '다음 달 첫째 주 토요일 서울 강남구에서 정기 모임이 있습니다. 많이 참여해주세요.',
    commentCount: 3,
    likeCount: 16,
  },
];

export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const [fabExpanded, setFabExpanded] = useState(true);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY > lastScrollY.current && currentY > 60) {
      setFabExpanded(false);
    } else if (currentY < lastScrollY.current) {
      setFabExpanded(true);
    }
    lastScrollY.current = currentY;
  };

  const renderItem = ({ item }: { item: PostItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => navigation.navigate('PostDetail', { post: item })}
      activeOpacity={0.85}
    >
      <View style={styles.cardTop}>
        {item.isNews ? (
          <View style={styles.newsBadge}>
            <Ionicons name="newspaper-outline" size={13} color={Colors.accent} />
            <Text style={styles.newsBadgeText}>뉴스</Text>
          </View>
        ) : (
          <View style={styles.categoryBadge}>
            <Ionicons name={item.categoryIcon} size={13} color={Colors.dark} />
            <Text style={styles.categoryBadgeText}>{item.category}</Text>
          </View>
        )}
        <Text style={styles.dateText}>{item.date}</Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.cardPreview} numberOfLines={2}>{item.preview}</Text>
        </View>
        {item.thumbnail && (
          <View style={styles.thumbnailBox}>
            <Text style={styles.thumbnailEmoji}>{item.thumbnail}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.metaText}>{item.author}  ·  조회 {item.views}</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="chatbubble-outline" size={13} color={Colors.textSub} />
            <Text style={styles.cardStat}>댓글 {item.commentCount}</Text>
          </View>
          <View style={[styles.statItem, { marginLeft: 12 }]}>
            <Ionicons name="heart-outline" size={13} color={Colors.textSub} />
            <Text style={styles.cardStat}>좋아요 {item.likeCount}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="파킨온" showMenu onMenuPress={() => rootNavigation.navigate('Menu')} />
      <View style={styles.flex}>
        <FlatList
          data={DUMMY_POSTS}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        />

        {/* 플로팅 버튼 */}
        <TouchableOpacity
          style={[styles.fab, !fabExpanded && styles.fabCircle]}
          onPress={() => navigation.navigate('PostWrite')}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={22} color={Colors.white} />
          {fabExpanded && <Text style={styles.fabText}>글쓰기</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  newsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newsBadgeText: { fontSize: 15, fontWeight: '700', color: Colors.accent },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.light,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryBadgeText: { fontSize: 15, fontWeight: '700', color: Colors.dark },
  dateText: { fontSize: 15, color: Colors.textHint, fontWeight: '500' },
  cardBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    gap: 12,
  },
  cardContent: { flex: 1 },
  thumbnailBox: {
    width: 64,
    height: 64,
    backgroundColor: Colors.light,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailEmoji: { fontSize: 32 },
  cardTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 6, lineHeight: 28 },
  cardPreview: { fontSize: 16, color: Colors.textSub, lineHeight: 24 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  metaText: { fontSize: 15, color: Colors.textSub, fontWeight: '500' },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStat: { fontSize: 15, color: Colors.textSub, fontWeight: '500' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    backgroundColor: Colors.primary,
    borderRadius: 28,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  fabCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    paddingVertical: 0,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
  },
});
