import React, { useRef, useState, useCallback } from 'react';
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
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { supabase } from '../../lib/supabase';

type Nav = NativeStackNavigationProp<FeedStackParamList, 'FeedMain'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PAGE_SIZE = 20;

export interface PostItem {
  id: string;
  isNews: boolean;
  category: string;
  categoryId?: string;
  categoryIcon: IoniconName;
  author: string;
  authorId?: string;
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

// 카테고리별 뱃지 색상
const CATEGORY_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  chat:     { bg: '#E8F5E9', text: '#2E7D32' }, // 연두
  question: { bg: '#E3F2FD', text: '#1565C0' }, // 파랑
  info:     { bg: '#FFF8E1', text: '#F57F17' }, // 노랑
  exercise: { bg: '#FCE4EC', text: '#AD1457' }, // 분홍
  cheer:    { bg: '#F3E5F5', text: '#6A1B9A' }, // 보라
  default:  { bg: '#F5F5F5', text: '#555555' },
};

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${year}년 ${month}월 ${day}일 ${hour}:${min}`;
}

function getThumbnailUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Cloudflare R2 이미지 리사이징
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}width=200&quality=75&format=webp`;
}

export function FeedScreen() {
  const navigation = useNavigation<Nav>();
const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  const [fabExpanded, setFabExpanded] = useState(true);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const mapPost = (p: any): PostItem => ({
    id: p.id,
    isNews: p.is_news ?? false,
    category: POST_TYPE_LABEL[p.post_type] ?? p.post_type ?? '기타',
    categoryId: p.post_type ?? undefined,
    categoryIcon: POST_TYPE_ICON[p.post_type] ?? 'chatbubble-outline',
    author: p.author?.name ?? '알 수 없음',
    authorId: p.author_id ?? undefined,
    date: formatDate(p.created_at),
    views: p.view_count ?? 0,
    title: p.title ?? '',
    preview: p.content ?? p.description ?? '',
    thumbnail: p.post_media
      ?.filter((m: any) => m.media_type === 'image')
      ?.sort((a: any, b: any) => a.sort_order - b.sort_order)?.[0]?.r2_url ?? undefined,
    commentCount: p.comment_count ?? 0,
    likeCount: p.like_count ?? 0,
  });

  const fetchPosts = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true);
      pageRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    try {
      const from = pageRef.current * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // posts 테이블 (post_media 첫 번째 사진 포함)
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('*, author:users(name), post_media(r2_url, sort_order, media_type)')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (postsError) throw postsError;

      // news_feed 테이블 (첫 페이지 리셋 시에만 최신 5개 혼합)
      let newsFeedItems: PostItem[] = [];
      if (reset) {
        const { data: newsData } = await supabase
          .from('news_feed')
          .select('id, title, description, published_at, source_name, url')
          .order('published_at', { ascending: false })
          .limit(5);

        newsFeedItems = (newsData ?? []).map((n: any) => ({
          id: 'news_' + n.id,
          isNews: true,
          category: '뉴스',
          categoryIcon: 'newspaper-outline' as IoniconName,
          author: n.source_name ?? '파킨온 뉴스',
          date: formatDate(n.published_at ?? new Date().toISOString()),
          views: 0,
          title: n.title ?? '',
          preview: n.description ?? '',
          commentCount: 0,
          likeCount: 0,
        }));
      }

      const mappedPosts = (postsData ?? []).map(mapPost);

      if (reset) {
        // 첫 페이지: 게시글과 뉴스 번갈아 배치
        const interleaved: PostItem[] = [];
        let ni = 0, pi = 0;
        while (ni < newsFeedItems.length || pi < mappedPosts.length) {
          if (pi < mappedPosts.length) interleaved.push(mappedPosts[pi++]);
          if (ni < newsFeedItems.length) interleaved.push(newsFeedItems[ni++]);
        }
        setPosts(interleaved);
      } else {
        setPosts(prev => [...prev, ...mappedPosts]);
      }

      setHasMore((postsData ?? []).length === PAGE_SIZE);
      pageRef.current += 1;
    } catch (e) {
      console.error('[FeedScreen] fetchPosts 오류:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // 화면 포커스 시 목록 갱신 (PostWrite 후 복귀 포함)
  useFocusEffect(
    useCallback(() => {
      fetchPosts(true);
    }, [fetchPosts])
  );

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore && !loading) {
      fetchPosts(false);
    }
  }, [loadingMore, hasMore, loading, fetchPosts]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY > lastScrollY.current && currentY > 60) {
      setFabExpanded(false);
    } else if (currentY < lastScrollY.current) {
      setFabExpanded(true);
    }
    lastScrollY.current = currentY;
  };

  const renderItem = ({ item }: { item: PostItem }) => {
    const badgeColors = item.isNews
      ? { bg: '#FFF3E0', text: '#E65100' }
      : (CATEGORY_BADGE_COLORS[item.categoryId ?? ''] ?? CATEGORY_BADGE_COLORS.default);

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('PostDetail', { post: item })}
        activeOpacity={0.82}
      >
        {/* 상단: 뱃지 + 날짜 */}
        <View style={styles.cardTop}>
          <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
            <Ionicons
              name={item.isNews ? 'newspaper-outline' : item.categoryIcon}
              size={13}
              color={badgeColors.text}
            />
            <Text style={[styles.badgeText, { color: badgeColors.text }]}>
              {item.isNews ? '뉴스' : item.category}
            </Text>
          </View>
          <Text style={styles.dateText}>{item.date}</Text>
        </View>

        {/* 본문: 제목 + 썸네일(뉴스/이미지 있을 때) */}
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          {item.thumbnail ? (
            <Image
              source={{ uri: getThumbnailUrl(item.thumbnail) }}
              style={styles.cardThumbnail}
              resizeMode="cover"
            />
          ) : null}
        </View>

        {/* 하단: 작성자 · 댓글 · 조회 한 줄 */}
        <View style={styles.cardBottom}>
          <Text style={styles.metaText} numberOfLines={1}>
            {item.author}
            {'  ·  '}
            <Ionicons name="chatbubble-outline" size={13} color="#888" />
            {' 댓글 '}{item.commentCount}
            {'  ·  조회 '}{item.views}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="파킨온" showParkinon />
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
            onRefresh={() => fetchPosts(true)}
            refreshing={loading}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            initialNumToRender={8}
            windowSize={10}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 16 }} />
              ) : null
            }
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
          <Ionicons name="create-outline" size={24} color={Colors.white} />
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
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 110 },
  emptyText: {
    textAlign: 'center',
    color: Colors.textHint,
    fontSize: 18,
    marginTop: 60,
    lineHeight: 30,
  },

  /* ── 카드 ── */
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
  },

  /* 상단: 뱃지 + 날짜 */
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 20,          // pill 형태
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 13,
    color: Colors.textHint,
    fontWeight: '400',
  },

  /* 본문: 제목 + 썸네일 */
  cardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  cardTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    lineHeight: 30,
  },
  cardThumbnail: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: '#E0E0E0',
    flexShrink: 0,
  },

  /* 하단: 작성자·통계 한 줄 */
  cardBottom: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
  },
  metaText: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '400',
  },

  /* ── FAB ── */
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    backgroundColor: Colors.primary,
    borderRadius: 30,
    paddingVertical: 15,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  fabCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    paddingVertical: 0,
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.white,
  },
});
