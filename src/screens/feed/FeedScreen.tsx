import React, { useRef, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Animated,
  NativeSyntheticEvent, NativeScrollEvent, ActivityIndicator, Image,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import i18n from '../../i18n';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { navigateTo } from '../../navigation/navigationRef';
import { CenterToast } from '../../components/common/CenterToast';
import { useToast } from '../../hooks/useToast';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { ensureNotBanned } from '../../utils/banGuard';
import { useBlocks } from '../../hooks/useBlocks';
import { getCommunityPhotoUrl } from '../../lib/r2Upload';

type Nav = NativeStackNavigationProp<FeedStackParamList, 'FeedMain'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PAGE_SIZE = 20;

// 목록에서 실제 사용하는 컬럼만 명시 (select('*') 대비 페이로드 축소).
// mapPost 가 쓰는 필드: id, is_news, post_type, author_id, created_at,
//   view_count, title, content, comment_count, like_count + author/post_media 조인.
const POST_SELECT =
  'id, is_news, post_type, author_id, created_at, view_count, title, content, comment_count, like_count, is_notice, author_name_override, author:public_user_profiles(name, role), post_media(r2_url, sort_order, media_type)';

export interface PostItem {
  id: string;
  isNews: boolean;
  category: string;
  categoryId?: string;
  categoryIcon: IoniconName;
  author: string;
  authorId?: string;
  authorRole?: string;  // 작성자 역할 표시 라벨 ('환자' | '보호자'). 뉴스 등은 undefined.
  date: string;
  views: number;
  title: string;
  preview: string;
  thumbnail?: string;
  commentCount: number;
  likeCount: number;
  isBookmarked?: boolean;
  isNotice?: boolean;
}

const POST_TYPE_ICON: Record<string, IoniconName> = {
  chat: 'chatbubble-outline',
  question: 'help-circle-outline',
  info: 'megaphone-outline',
  exercise: 'fitness-outline',
  cheer: 'heart-circle-outline',
};

function getPostTypeLabel(type: string): string {
  const map: Record<string, string> = {
    chat: i18n.t('feed.typeChat'),
    question: i18n.t('feed.typeQuestion'),
    info: i18n.t('feed.typeInfo'),
    exercise: i18n.t('feed.typeExercise'),
    cheer: i18n.t('feed.typeCheer'),
  };
  return map[type] ?? type;
}

// 카테고리별 뱃지 색상
const CATEGORY_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  chat:     { bg: '#E8F5E9', text: '#2E7D32' },
  question: { bg: '#E3F2FD', text: '#1565C0' },
  info:     { bg: '#FFF8E1', text: '#F57F17' },
  exercise: { bg: '#FCE4EC', text: '#AD1457' },
  cheer:    { bg: '#F3E5F5', text: '#6A1B9A' },
  default:  { bg: '#F5F5F5', text: '#555555' },
};

// 서브탭 목록 (뉴스는 정보에 통합)
function getSubTabs() {
  return [
    { id: 'all',      label: i18n.t('feed.typeAll') },
    { id: 'chat',     label: i18n.t('feed.typeChat') },
    { id: 'question', label: i18n.t('feed.typeQuestion') },
    { id: 'info',     label: i18n.t('feed.typeInfo') },
    { id: 'cheer',    label: i18n.t('feed.typeCheer') },
  ];
}

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (i18n.language !== 'ko') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const day = DAYS_KO[d.getDay()];
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month}월 ${date}일 (${day}) ${hh}:${mm}`;
}

type MainTab = 'all' | 'bookmarks' | 'mine';

/**
 * 마지막으로 본 기본 목록을 담아두는 키.
 *
 * 언어를 키에 넣는 이유: 저장하는 항목은 이미 그 언어로 만들어진 상태(카테고리 라벨·날짜)라,
 * 언어를 바꾸면 예전 언어의 목록이 잠깐 보인다. 언어별로 따로 담아 그 일이 없게 한다.
 */
const feedCacheKey = () => `parkinon_feed_cache_v1_${i18n.language}`;

export function FeedScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { unreadCount } = useNotificationBadge();
  const { toastMsg, toastVisible, showToast } = useToast();
  const { user, signOut } = useAuth();
  const dialog = useDialog();
  // 차단한 사용자 글 제외 (App Store 1.2 UGC)
  const { blockedIds, refresh: refreshBlocks } = useBlocks();
  const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  // 탭 버튼 누를 때 항상 맨 위로
  const listRef = useRef<FlatList>(null);
  useScrollTopOnTabPress(listRef);
  const [fabExpanded, setFabExpanded] = useState(true);
  const [posts, setPosts] = useState<PostItem[]>([]);
  // fetchPosts 안에서 "이미 목록이 있는지"를 보기 위한 참조.
  //   posts 를 의존성에 넣으면 fetchPosts 가 매번 새로 만들어지고,
  //   그걸 의존하는 useFocusEffect 가 다시 돌아 재조회가 반복된다.
  const postsRef = useRef<PostItem[]>([]);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  const [loading, setLoading] = useState(true);
  // 빨리 오면 스켈레톤을 아예 띄우지 않는다(회색 바 깜빡임 방지).
  const showListSkeleton = useDelayedFlag(loading);

  // 저장해 둔 지난 목록을 먼저 그린다 — 서버 응답을 기다리는 동안 빈 화면/회색 바를 없앤다.
  //   네트워크 조회는 그대로 진행되고, 도착하면 조용히 갈아끼운다.
  //   이미 목록이 채워졌으면(빠른 응답) 덮어쓰지 않는다.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(feedCacheKey())
      .then((raw) => {
        if (cancelled || !raw) return;
        if (postsRef.current.length > 0) return;
        const cached = JSON.parse(raw) as PostItem[];
        if (Array.isArray(cached) && cached.length > 0) {
          setPosts(cached);
          setLoading(false);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  // 검색 상태
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchQueryRef = useRef('');

  // 탭 상태
  const [mainTab, setMainTab] = useState<MainTab>('all');
  const mainTabRef = useRef<MainTab>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const typeFilterRef = useRef('all');

  // 읽은 글 추적 (AsyncStorage)
  const READ_POSTS_KEY = 'parkinon_read_posts';
  const [readPostIds, setReadPostIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    AsyncStorage.getItem(READ_POSTS_KEY).then(raw => {
      if (raw) setReadPostIds(new Set(JSON.parse(raw)));
    }).catch(() => {});
  }, []);
  const markAsRead = useCallback((postId: string) => {
    setReadPostIds(prev => {
      if (prev.has(postId)) return prev;
      const next = new Set(prev);
      next.add(postId);
      const arr = Array.from(next).slice(-500);
      AsyncStorage.setItem(READ_POSTS_KEY, JSON.stringify(arr)).catch(() => {});
      return new Set(arr);
    });
  }, []);

  // 북마크 ref (의존성 루프 방지)
  const bookmarkedIdsRef = useRef<Set<string>>(new Set());

  const mapPost = useCallback((p: any): PostItem => ({
    id: p.id,
    isNews: p.is_news ?? false,
    category: p.post_type ? getPostTypeLabel(p.post_type) : i18n.t('feed.typeEtc'),
    categoryId: p.post_type ?? undefined,
    categoryIcon: POST_TYPE_ICON[p.post_type] ?? 'chatbubble-outline',
    // 공지는 관리자가 지정한 임의 작성자명(author_name_override) 우선 — 실제 계정과 무관.
    author: p.author_name_override || p.author?.name || i18n.t('feed.authorUnknown'),
    authorId: p.author_id ?? undefined,
    // 작성자 역할 라벨(DiaryScreen 과 동일 규칙: caregiver→보호자, 그 외→환자).
    // 공지(작성자명 오버라이드)는 실제 계정 역할이 아니므로 라벨 생략.
    authorRole: (!p.author_name_override && p.author?.role)
      ? (p.author.role === 'caregiver' ? i18n.t('feed.authorRoleCaregiver') : i18n.t('feed.authorRolePatient'))
      : undefined,
    date: formatDate(p.created_at),
    views: p.view_count ?? 0,
    title: p.title ?? '',
    preview: p.content ?? p.description ?? '',
    thumbnail: p.post_media
      ?.filter((m: any) => m.media_type === 'image')
      ?.sort((a: any, b: any) => a.sort_order - b.sort_order)?.[0]?.r2_url ?? undefined,
    commentCount: p.comment_count ?? 0,
    likeCount: p.like_count ?? 0,
    isBookmarked: bookmarkedIdsRef.current.has(p.id),  // ref 사용 (state X)
    isNotice: p.is_notice ?? false,
  }), []); // ← 의존성 빈 배열 (안정적인 참조 유지)

  const fetchBookmarks = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('post_bookmarks')
      .select('post_id')
      .eq('user_id', session.user.id);
    bookmarkedIdsRef.current = new Set((data ?? []).map((b: any) => b.post_id));
  }, []);

  const toggleBookmark = useCallback(async (postId: string, currentlyBookmarked: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;
    // ref 낙관적 업데이트
    if (currentlyBookmarked) bookmarkedIdsRef.current.delete(postId);
    else bookmarkedIdsRef.current.add(postId);
    // posts 직접 업데이트
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, isBookmarked: !currentlyBookmarked } : p));
    if (currentlyBookmarked) {
      await supabase.from('post_bookmarks').delete()
        .eq('user_id', session.user.id).eq('post_id', postId);
      showToast(t('feed.bookmarkOff'));
    } else {
      await supabase.from('post_bookmarks').insert({ user_id: session.user.id, post_id: postId });
      showToast(t('feed.bookmarkOn'));
    }
  }, [showToast]);

  const fetchPosts = useCallback(async (reset = true, overrideSearch?: string, overrideCategory?: string, overrideTab?: MainTab) => {
    if (reset) {
      // 이미 받아둔 목록이 있으면 스피너로 덮지 않는다.
      //   탭에 들어올 때마다(useFocusEffect) 다시 조회하는데, 그때마다 loading=true 로
      //   화면을 비우면 이미 본 글이 사라졌다가 다시 나타나 "매번 처음 여는 것처럼" 느껴진다.
      //   목록은 그대로 두고 뒤에서 갱신한 뒤 조용히 갈아끼운다.
      if (postsRef.current.length === 0) setLoading(true);
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
          .select(`post_id, posts!inner(${POST_SELECT})`)
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
          .select(POST_SELECT)
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

      const mapNews = (n: any): PostItem => ({
        id: 'news_' + n.id, isNews: true, category: i18n.t('feed.typeInfo'),
        categoryIcon: 'newspaper-outline' as IoniconName,
        author: n.source_name ?? i18n.t('feed.newsSourceDefault'),
        date: formatDate(n.published_at ?? new Date().toISOString()),
        views: 0, title: n.title ?? '', preview: n.description ?? '',
        commentCount: 0, likeCount: 0,
      });

      // 정보 탭: info 게시글 + 뉴스 통합 (공지는 '전체' 탭 상단 고정에서만 노출 — 중복 방지)
      if (currentCategory === 'info') {
        let query = supabase
          .from('posts')
          .select(POST_SELECT)
          .eq('post_type', 'info')
          .eq('is_notice' as any, false)
          .order('created_at', { ascending: false })
          .range(from, to);
        if (currentSearch.trim()) query = query.ilike('title', `%${currentSearch.trim()}%`);

        // 게시글 + 뉴스를 병렬 조회 (순차 await 제거)
        const wantNews = !currentSearch.trim() && reset;
        const newsPromise = wantNews
          ? supabase
              .from('news_feed')
              .select('id, title, description, published_at, source_name, url')
              .order('published_at', { ascending: false })
              .limit(5)
          : Promise.resolve({ data: null });
        const [{ data: postsData, error: postsError }, { data: newsData }] = await Promise.all([
          query,
          newsPromise,
        ]);
        if (postsError) throw postsError;
        mappedPosts = (postsData ?? []).map(mapPost);
        if (wantNews) newsFeedItems = (newsData ?? []).map(mapNews);

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
        return;
      }

      let query = supabase
        .from('posts')
        .select(POST_SELECT)
        .eq('is_notice' as any, false)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (currentCategory !== 'all') query = query.eq('post_type', currentCategory);
      if (currentSearch.trim()) query = query.ilike('title', `%${currentSearch.trim()}%`);

      // 전체 탭: 게시글 + 뉴스 인터리빙 → 병렬 조회 (순차 await 제거)
      const wantNews = currentCategory === 'all' && !currentSearch.trim() && reset;
      const newsPromise = wantNews
        ? supabase
            .from('news_feed')
            .select('id, title, description, published_at, source_name, url')
            .order('published_at', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: null });
      // 공지: '전체' 탭·무검색·첫 페이지에서만 조회해 맨 위에 고정 노출(중복 방지로 다른 조건에선 미노출).
      const wantNotices = wantNews;
      const noticesPromise = wantNotices
        ? supabase
            .from('posts')
            .select(POST_SELECT)
            .eq('is_notice' as any, true)
            .eq('hidden', false)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: null });
      const [{ data: postsData, error: postsError }, { data: newsData }, { data: noticesData }] = await Promise.all([
        query,
        newsPromise,
        noticesPromise,
      ]);
      if (postsError) throw postsError;
      mappedPosts = (postsData ?? []).map(mapPost);
      if (wantNews) newsFeedItems = (newsData ?? []).map(mapNews);
      const mappedNotices: PostItem[] = wantNotices ? (noticesData ?? []).map(mapPost) : [];

      if (reset) {
        let finalList: PostItem[];
        if (newsFeedItems.length > 0) {
          const interleaved: PostItem[] = [];
          let ni = 0, pi = 0;
          while (ni < newsFeedItems.length || pi < mappedPosts.length) {
            if (pi < mappedPosts.length) interleaved.push(mappedPosts[pi++]);
            if (ni < newsFeedItems.length) interleaved.push(newsFeedItems[ni++]);
          }
          finalList = [...mappedNotices, ...interleaved];
        } else {
          finalList = [...mappedNotices, ...mappedPosts];
        }
        setPosts(finalList);
        // 기본 화면(전체 탭·검색 없음·필터 없음)만 저장해 둔다.
        //   다음에 정보·나눔을 열 때 이걸 즉시 그려서 회색 바 없이 글이 바로 보이게 한다.
        //   검색·필터 결과까지 저장하면 엉뚱한 목록이 먼저 보이므로 기본 화면만 대상.
        if (currentTab === 'all' && !currentSearch.trim() && currentCategory === 'all') {
          AsyncStorage.setItem(feedCacheKey(), JSON.stringify(finalList.slice(0, PAGE_SIZE))).catch(() => {});
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

  // 화면 포커스 시 북마크 + 게시글을 병렬 로드 (순차 then 제거).
  // 목록 행에는 북마크 표시가 없고 상세 화면이 북마크 상태를 재조회하므로
  // 두 요청의 완료 순서는 사용자 경험에 영향 없음 → 병렬화로 첫 로딩 단축.
  const focusFetchingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      refreshBlocks();
      if (focusFetchingRef.current) return; // 중복 동시호출 가드
      focusFetchingRef.current = true;
      Promise.all([
        fetchBookmarks(),
        fetchPosts(true, searchQueryRef.current, typeFilterRef.current, mainTabRef.current),
      ]).finally(() => {
        focusFetchingRef.current = false;
      });
    }, [fetchPosts, fetchBookmarks, refreshBlocks])
  );

  // 차단한 사용자의 게시글 제외 (뉴스는 authorId 없음 → 항상 표시)
  const visiblePosts = posts.filter((p) => !p.authorId || !blockedIds.has(p.authorId));

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

  // 글유형 서브탭 선택
  const handleTypeFilterSelect = useCallback((typeId: string) => {
    typeFilterRef.current = typeId;
    setTypeFilter(typeId);
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
      return t('feed.emptySearch', { query: searchQuery });
    }
    if (mainTab === 'bookmarks') return t('feed.emptyBookmarks');
    if (mainTab === 'mine') return t('feed.emptyMine');
    if (typeFilter !== 'all') {
      const opt = getSubTabs().find(o => o.id === typeFilter);
      return t('feed.emptyTypeFilter', { type: opt?.label ?? typeFilter });
    }
    return t('feed.emptyDefault');
  };

  const renderItem = ({ item }: { item: PostItem }) => {
    return (
      <TouchableOpacity
        style={[styles.row, item.isNotice && styles.rowNotice]}
        onPress={() => {
          markAsRead(item.id);
          navigation.navigate('PostDetail', { post: item });
        }}
        activeOpacity={0.75}
      >
        {/* 중앙 콘텐츠 */}
        <View style={styles.rowContent}>
          {item.isNotice && (
            <View style={styles.noticeBadge}>
              <Ionicons name="pin" size={12} color={Colors.white} />
              <Text style={styles.noticeBadgeText}>{t('feed.noticeBadge')}</Text>
            </View>
          )}
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
            {item.thumbnail ? (
              <Image
                source={{ uri: getCommunityPhotoUrl(item.thumbnail) }}
                style={styles.rowThumb}
                resizeMode="cover"
              />
            ) : null}
          </View>
          <View style={styles.rowMeta}>
            <Text style={styles.metaText} numberOfLines={1}>
              {item.author}{' · '}{item.date}{t('feed.viewsMeta')}{item.views}
            </Text>
          </View>
        </View>

        {/* 댓글 박스 */}
        <View style={styles.commentBox}>
          <Text style={styles.commentCount}>{item.commentCount}</Text>
          <Text style={styles.commentLabel}>{t('feed.commentLabel')}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('medication.brandTitle')}
        showParkinon
        showDiary
        onDiaryPress={() => navigateTo('Diary')}
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
      />

      {/* 메인 탭 */}
      <View style={styles.tabRow}>
        {([['all', t('feed.mainTabAll')], ['bookmarks', t('feed.mainTabBookmarks')], ['mine', t('feed.mainTabMine')]] as [MainTab, string][]).map(([tab, label]) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, mainTab === tab && styles.tabActive]}
            onPress={() => handleTabChange(tab)}
            activeOpacity={0.75}
          >
            <Text style={[styles.tabText, mainTab === tab && styles.tabTextActive]} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 서브탭 (글유형 필터) — 전체 탭에서만 */}
      {mainTab === 'all' && (
        <View style={styles.subTabRow}>
          {getSubTabs().map((sub) => {
            const isActive = typeFilter === sub.id;
            return (
              <TouchableOpacity
                key={sub.id}
                style={[styles.subTab, isActive && styles.subTabActive]}
                onPress={() => handleTypeFilterSelect(sub.id)}
                activeOpacity={0.75}
              >
                <Text style={[styles.subTabText, isActive && styles.subTabTextActive]} numberOfLines={1}>
                  {sub.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* 검색창 — 위치 미정, 임시 숨김 처리 */}
      {false && (
        <View style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}>
          <Ionicons name="search-outline" size={20} color="#AAAAAA" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('feed.searchPlaceholder')}
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
      )}

      <View style={styles.flex}>
        {showListSkeleton ? (
          <View style={styles.listContent}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.skelRow}>
                <View style={styles.skelContent}>
                  <View style={[styles.skelLine, { width: '85%' }]} />
                  <View style={[styles.skelLine, { width: '55%', marginTop: 10 }]} />
                  <View style={[styles.skelMeta, { marginTop: 12 }]} />
                </View>
                <View style={styles.skelComment} />
              </View>
            ))}
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={visiblePosts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={[styles.listContent, { paddingBottom: 110 + insets.bottom }]}
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
          style={[styles.fab, !fabExpanded && styles.fabCircle, { bottom: 28 + insets.bottom }]}
          onPress={async () => {
            if (await ensureNotGuest(user, dialog, { signOut })) return;
            if (ensureNotBanned(user, dialog)) return;
            navigation.navigate('PostWrite');
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={24} color={Colors.white} />
          {fabExpanded && <Text style={styles.fabText}>{t('feed.writeButton')}</Text>}
        </TouchableOpacity>
      </View>
      <CenterToast message={toastMsg} visible={toastVisible} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1, backgroundColor: Colors.white },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* ── 로딩 스켈레톤 (더미 행) ── */
  skelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  skelContent: { flex: 1 },
  skelLine: {
    height: 16,
    borderRadius: 5,
    backgroundColor: '#ECECEC',
  },
  skelMeta: {
    height: 12,
    width: '40%',
    borderRadius: 5,
    backgroundColor: '#F1F1F1',
  },
  skelComment: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#F1F1F1',
    marginLeft: 10,
  },
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
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
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
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: Colors.white,
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

  /* ── 서브탭 ── */
  subTabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  // 전역 필터칩 표준 = 영상목록 필터(오너 확정). 5개 등폭이라 padH만 작게.
  subTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTabActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  subTabText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  subTabTextActive: {
    fontWeight: '600',
    color: Colors.white,
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
  rowNotice: {
    backgroundColor: '#FFF8E1',
  },
  noticeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 3,
    marginBottom: 6,
  },
  noticeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.white,
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
  rowTitleRead: {
    color: '#999999',
    fontWeight: '400',
  },
  rowThumb: {
    width: 52,
    height: 52,
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
    width: 52,
    minHeight: 52,
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
