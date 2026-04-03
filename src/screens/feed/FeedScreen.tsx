import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
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
import { supabase } from '../../lib/supabase';

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

const POST_TYPE_ICON: Record<string, IoniconName> = {
  chat: 'chatbubble-outline',
  question: 'help-circle-outline',
  info: 'megaphone-outline',
  exercise: 'fitness-outline',
  cheer: 'heart-circle-outline',
};

const POST_TYPE_LABEL: Record<string, string> = {
  chat: '자유수다',
  question: '질문있어요',
  info: '정보공유',
  exercise: '운동인증',
  cheer: '응원해요',
};

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function FeedScreen() {
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const [fabExpanded, setFabExpanded] = useState(true);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('posts')
        .select('*, author:users(name)')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const mapped: PostItem[] = (data ?? []).map((p: any) => ({
        id: p.id,
        isNews: p.is_news ?? false,
        category: POST_TYPE_LABEL[p.post_type] ?? p.post_type,
        categoryIcon: POST_TYPE_ICON[p.post_type] ?? 'chatbubble-outline',
        author: p.author?.name ?? '알 수 없음',
        date: formatDate(p.created_at),
        views: p.view_count ?? 0,
        title: p.title,
        preview: p.content,
        commentCount: p.comment_count ?? 0,
        likeCount: p.like_count ?? 0,
      }));

      setPosts(mapped);
    } catch (e) {
      console.error('[FeedScreen] fetchPosts 오류:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

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
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onRefresh={fetchPosts}
            refreshing={loading}
            ListEmptyComponent={
              <Text style={styles.emptyText}>아직 게시글이 없어요.{'\n'}첫 글을 작성해보세요!</Text>
            }
          />
        )}

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
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 100 },
  emptyText: { textAlign: 'center', color: Colors.textHint, fontSize: 17, marginTop: 60, lineHeight: 28 },
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
    marginBottom: 16,
  },
  cardContent: { flex: 1 },
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
