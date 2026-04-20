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
  TextInput,
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
  isBookmarked?: boolean;
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
  chat:     { bg: '#E8F5E9', text: '#2E7D32' },
  question: { bg: '#E3F2FD', text: '#1565C0' },
  info:     { bg: '#FFF8E1', text: '#F57F17' },
  exercise: { bg: '#FCE4EC', text: '#AD1457' },
  cheer:    { bg: '#F3E5F5', text: '#6A1B9A' },
  default:  { bg: '#F5F5F5', text: '#555555' },
};

// 필터칩 목록 (유지)
const FILTER_CHIPS = [
  { id: 'all',      label: '전체' },
  { id: 'cheer',    label: '응원해요' },
  { id: 'question', label: '질문있어요' },
  { id: 'chat',     label: '자유수다' },
  { id: 'info',     label: '정보공유' },
  { id: 'exercise', label: '운동인증' },
  { id: 'news',     label: '뉴스' },
];

// 글유형 드롭다운 옵션
const TYPE_FILTER_OPTIONS = [
  { id: 'all',      label: '전체' },
  { id: 'chat',     label: '자유수다' },
  { id: 'question', label: '질문있어요' },
  { id: 'info',     label: '정보공유' },
  { id: 'exercise', label: '운동인증' },
  { id: 'cheer',    label: '응원해요' },
  { id: 'news',     label: '뉴스' },
];

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 7) return `${diffDay}일 전`;
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function getThumbnailUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}width=200&quality=75&format=webp`;
}

type MainTab = 'all' | 'bookmarks' | 'mine';

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

  // 검색 상태
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchQueryRef = useRef('');

  // 탭 및 드롭다운 상태
  const [mainTab, setMainTab] = useState<MainTab>('all');
  const mainTabRef = useRef<MainTab>('all');
  const [typeDropdownVisible, setTypeDropdownVisible] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const typeFilterRef = useRef('all');

  // 북마크 상태
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());

  const mapPost = useCallback((p: any): PostItem => ({
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
    isBookmarked: bookmarkedIds.has(p.id),
  }), [bookmarkedIds]);

  const fetchBookmarks = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('post_bookmarks')
      .select('post_id')
      .eq('user_id', session.user.id);
    setBookmarkedIds(new Set((data ?? []).map((b: any) => b.post_id)));
  }, []);

  const toggleBookmark = useCallback(async (postId: string, currentlyBookmarked: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    // 낙관적 업데이트
    setBookmarkedIds(prev => {
      const next = new Set(prev);
      if (currentlyBookmarked) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, isBookmarked: !currentlyBookmarked } : p));
    if (currentlyBookmarked) {
      await supabase.from('post_bookmarks').delete()
        .eq('user_id', session.user.id).eq('post_id', postId);
    } else {
      await supabase.from('post_bookmarks').insert({ user_id: session.user.id, post_id: postId });
    }
  }, []);

  const fetchPosts = useCallback(async (reset = true, overrideSearch?: string, overrideCategory?: string, overrideTab?: MainTab) => {
    if (reset) {
      setLoading(true);
      pageRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    try {
      const from = pageRef.current * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const currentSearch = overrideSearch !== undefined ? overrideSearch : searchQueryRef.current;
      const currentCategory = overrideCategory !== undefined ? overrideCategory : typeFilterRef.current;
      const currentTab = overrideTab !== undefined ? overrideTab : mainTabRef.current;

      // 북마크 탭
      if (currentTab === 'bookmarks') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setPosts([]); setLoading(false); setLoadingMore(false); return; }
        const { data, error } = await supabase
          .from('post_bookmarks')
          .select('post_id, posts!inner(*, author:users(name), post_media(r2_url, sort_order, media_type))')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .range(from, to);
        if (error) throw error;
        const mapped = (data ?? []).map((b: any) => mapPost({ ...b.posts, id: b.post_id }));
        if (reset) setPosts(mapped); else setPosts(prev => [...prev, ...mapped]);
        setHasMore((data ?? []).length === PAGE_SIZE);
        pageRef.current += 1;
        return;
      }

      // 내가쓴글 탭
      if (currentTab === 'mine') {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { setPosts([]); setLoading(false); setLoadingMore(false); return; }
        let q = supabase
          .from('posts')
          .select('*, author:users(name), post_media(r2_url, sort_order, media_type)')
          .eq('author_id', session.user.id)
          .order('created_at', { ascending: false })
          .range(from, to);
        if (currentSearch.trim()) q = q.ilike('title', `%${currentSearch.trim()}%`);
        const { data, error } = await q;
        if (error) throw error;
        const mapped = (data ?? []).map(mapPost);
        if (reset) setPosts(mapped); else setPosts(prev => [...prev, ...mapped]);
        setHasMore((data ?? []).length === PAGE_SIZE);
        pageRef.current += 1;
        return;
      }

      // 전체 탭 — 기존 로직 (뉴스 혼합 포함)
      let mappedPosts: PostItem[] = [];
      let newsFeedItems: PostItem[] = [];

      if (currentCategory === 'news') {
        const { data: newsData } = await supabase
          .from('news_feed')
          .select('id, title, description, published_at, source_name, url')
          .order('published_at', { ascending: false })
          .range(from, to);
        newsFeedItems = (newsData ?? []).map((n: any) => ({
          id: 'news_' + n.id, isNews: true, category: '뉴스',
          categoryIcon: 'newspaper-outline' as IoniconName,
          author: n.source_name ?? '파킨온 뉴스',
          date: formatDate(n.published_at ?? new Date().toISOString()),
          views: 0, title: n.title ?? '', preview: n.description ?? '',
          commentCount: 0, likeCount: 0,
        }));
        if (reset) setPosts(newsFeedItems); else setPosts(prev => [...prev, ...newsFeedItems]);
        setHasMore((newsData ?? []).length === PAGE_SIZE);
        pageRef.current += 1;
        return;
      }

      let query = supabase
        .from('posts')
        .select('*, author:users(name), post_media(r2_url, sort_order, media_type)')
        .order('created_at', { ascending: false })
        .range(from, to);
      if (currentCategory !== 'all') query = query.eq('post_type', currentCategory);
      if (currentSearch.trim()) query = query.ilike('title', `%${currentSearch.trim()}%`);
      const { data: postsData, error: postsError } = await query;
      if (postsError) throw postsError;
      mappedPosts = (postsData ?? []).map(mapPost);

      if (currentCategory === 'all' && !currentSearch.trim() && reset) {
        const { data: newsData } = await supabase
          .from('news_feed')
          .select('id, title, description, published_at, source_name, url')
          .order('published_at', { ascending: false })
          .limit(5);
        newsFeedItems = (newsData ?? []).map((n: any) => ({
          id: 'news_' + n.id, isNews: true, category: '뉴스',
          categoryIcon: 'newspaper-outline' as IoniconName,
          author: n.source_name ?? '파킨온 뉴스',
          date: formatDate(n.published_at ?? new Date().toISOString()),
          views: 0, title: n.title ?? '', preview: n.description ?? '',
          commentCount: 0, likeCount: 0,
        }));
      }

      if (reset) {
        if (newsFeedItems.length > 0) {
          const interleaved: PostItem[] = [];
          let ni = 0, pi = 0;
          while (ni < newsFeedItems.length || pi < mappedPosts.length) {
            if (pi < mappedPosts.length) interleaved.push(mappedPosts[pi++]);
            if (ni < newsFeedItems.length) interleaved.push(newsFeedItems[ni++]);
          }
          setPosts(interleaved);
        } else {
          setPosts(mappedPosts);
        }
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
  }, [mapPost]);

  // 화면 포커스 시 북마크 먼저 fetch 후 게시글 로드
  useFocusEffect(
    useCallback(() => {
      fetchBookmarks().then(() => {
        fetchPosts(true, searchQueryRef.current, typeFilterRef.current, mainTabRef.current);
      });
    }, [fetchPosts, fetchBookmarks])
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

  // 검색 실행
  const handleSearchSubmit = useCallback(() => {
    const trimmed = searchInput.trim();
    searchQueryRef.current = trimmed;
    setSearchQuery(trimmed);
    fetchPosts(true, trimmed, typeFilterRef.current, mainTabRef.current);
  }, [searchInput, fetchPosts]);

  // 검색 초기화
  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    searchQueryRef.current = '';
    setSearchQuery('');
    fetchPosts(true, '', typeFilterRef.current, mainTabRef.current);
  }, [fetchPosts]);

  // 글유형 드롭다운 선택
  const handleTypeFilterSelect = useCallback((typeId: string) => {
    typeFilterRef.current = typeId;
    setTypeFilter(typeId);
    setTypeDropdownVisible(false);
    fetchPosts(true, searchQueryRef.current, typeId, mainTabRef.current);
  }, [fetchPosts]);

  // 탭 변경
  const handleTabChange = useCallback((tab: MainTab) => {
    mainTabRef.current = tab;
    setMainTab(tab);
    fetchPosts(true, searchQueryRef.current, typeFilterRef.current, tab);
  }, [fetchPosts]);

  // Empty State 텍스트
  const getEmptyText = () => {
    if (searchQuery.trim()) {
      return `'${searchQuery}'에 대한\n게시글을 찾지 못했어요`;
    }
    if (mainTab === 'bookmarks') return '즐겨찾기한 글이 없어요\n북마크를 추가해보세요!';
    if (mainTab === 'mine') return '작성한 글이 없어요\n첫 글을 써보세요!';
    if (typeFilter !== 'all') {
      const opt = TYPE_FILTER_OPTIONS.find(o => o.id === typeFilter);
      return `아직 ${opt?.label ?? typeFilter} 글이 없어요\n첫 번째로 글을 써보세요!`;
    }
    return '아직 게시글이 없어요.\n첫 글을 작성해보세요!';
  };

  const renderItem = ({ item }: { item: PostItem }) => {
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('PostDetail', { post: item })}
        activeOpacity={0.75}
      >
        {/* 불릿 */}
        <Text style={styles.bullet}>•</Text>

        {/* 중앙 콘텐츠 */}
        <View style={styles.rowContent}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
            {item.thumbnail ? (
              <Image
                source={{ uri: getThumbnailUrl(item.thumbnail) }}
                style={styles.rowThumb}
                resizeMode="cover"
              />
            ) : null}
          </View>
          <View style={styles.rowMeta}>
            <Text style={styles.metaText} numberOfLines={1}>
              {item.author}{'  '}{item.date}{'  조회 '}{item.views}
            </Text>
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => toggleBookmark(item.id, !!item.isBookmarked)}
              style={{ marginLeft: 8 }}
            >
              <Ionicons
                name={item.isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={item.isBookmarked ? Colors.primary : '#AAAAAA'}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* 댓글 박스 */}
        <View style={styles.commentBox}>
          <Text style={styles.commentCount}>{item.commentCount}</Text>
          <Text style={styles.commentLabel}>댓글</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="파킨온" showParkinon />

      {/* 검색창 */}
      <View style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}>
        <Ionicons name="search-outline" size={20} color="#AAAAAA" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="제목으로 검색..."
          placeholderTextColor="#AAAAAA"
          value={searchInput}
          onChangeText={setSearchInput}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          onSubmitEditing={handleSearchSubmit}
          returnKeyType="search"
        />
        {searchInput.length > 0 && (
          <TouchableOpacity onPress={handleClearSearch} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={20} color="#AAAAAA" />
          </TouchableOpacity>
        )}
      </View>

      {/* 탭 + 드롭다운 */}
      <View style={styles.tabRow}>
        <View style={styles.tabs}>
          {([['all', '전체'], ['bookmarks', '즐겨찾기'], ['mine', '내가쓴글']] as [MainTab, string][]).map(([tab, label]) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, mainTab === tab && styles.tabActive]}
              onPress={() => handleTabChange(tab)}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, mainTab === tab && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* 글유형 드롭다운 — 전체 탭에서만 표시 */}
        {mainTab === 'all' && (
          <TouchableOpacity
            style={styles.typeDropdownBtn}
            onPress={() => setTypeDropdownVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={styles.typeDropdownText}>
              {TYPE_FILTER_OPTIONS.find(o => o.id === typeFilter)?.label ?? '전체'}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#555" />
          </TouchableOpacity>
        )}
      </View>

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
            onRefresh={() => fetchPosts(true, searchQueryRef.current, typeFilterRef.current, mainTabRef.current)}
            refreshing={loading}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            removeClippedSubviews={true}
            maxToRenderPerBatch={5}
            initialNumToRender={8}
            windowSize={10}
            ListFooterComponent={loadingMore ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 16 }} /> : null}
            ListEmptyComponent={<Text style={styles.emptyText}>{getEmptyText()}</Text>}
          />
        )}

        {/* 플로팅 글쓰기 버튼 */}
        <TouchableOpacity
          style={[styles.fab, !fabExpanded && styles.fabCircle]}
          onPress={() => navigation.navigate('PostWrite')}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={24} color={Colors.white} />
          {fabExpanded && <Text style={styles.fabText}>글쓰기</Text>}
        </TouchableOpacity>
      </View>

      {/* 글유형 드롭다운 모달 */}
      {typeDropdownVisible && (
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setTypeDropdownVisible(false)}
        >
          <View style={styles.dropdownMenu}>
            {TYPE_FILTER_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.dropdownItem, typeFilter === opt.id && styles.dropdownItemSelected]}
                onPress={() => handleTypeFilterSelect(opt.id)}
              >
                <Text style={[styles.dropdownItemText, typeFilter === opt.id && styles.dropdownItemTextSelected]}>
                  {opt.label}
                </Text>
                {typeFilter === opt.id && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingTop: 0, paddingBottom: 110 },
  emptyText: {
    textAlign: 'center',
    color: Colors.textHint,
    fontSize: 18,
    marginTop: 60,
    lineHeight: 30,
  },

  /* ── 검색창 ── */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#EEEEEE',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  searchBarFocused: {
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    color: '#111111',
    paddingVertical: 0,
  },

  /* ── 탭바 ── */
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: Colors.white,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#888888',
  },
  tabTextActive: {
    fontWeight: '700',
    color: Colors.primary,
  },
  typeDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  typeDropdownText: {
    fontSize: 15,
    color: '#444444',
    fontWeight: '600',
  },

  /* ── BBS 리스트 행 ── */
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  bullet: {
    fontSize: 16,
    color: Colors.primary,
    marginTop: 2,
    marginRight: 8,
    lineHeight: 26,
  },
  rowContent: {
    flex: 1,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#111111',
    lineHeight: 26,
    marginBottom: 6,
  },
  rowThumb: {
    width: 64,
    height: 64,
    borderRadius: 6,
    backgroundColor: '#E0E0E0',
    flexShrink: 0,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    flex: 1,
    fontSize: 14,
    color: '#888888',
  },

  /* ── 댓글 박스 ── */
  commentBox: {
    width: 48,
    minHeight: 48,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
    paddingVertical: 6,
  },
  commentCount: {
    fontSize: 17,
    fontWeight: '700',
    color: '#444444',
  },
  commentLabel: {
    fontSize: 11,
    color: '#888888',
    marginTop: 1,
  },

  /* ── 드롭다운 ── */
  dropdownOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 999,
  },
  dropdownMenu: {
    position: 'absolute',
    right: 12,
    top: 130,
    backgroundColor: Colors.white,
    borderRadius: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    minWidth: 140,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  dropdownItemSelected: {
    backgroundColor: '#F0FAF0',
  },
  dropdownItemText: {
    fontSize: 17,
    color: '#333333',
  },
  dropdownItemTextSelected: {
    fontWeight: '700',
    color: Colors.primary,
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
