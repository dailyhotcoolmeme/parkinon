import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  ActivityIndicator,
} from 'react-native';

// 카테고리별 색상 매핑 (categoryId 기준 — 라벨 텍스트는 로케일에 따라 바뀌므로 ID로 매칭)
const CATEGORY_COLORS_BY_ID: Record<string, { bg: string; text: string; icon: string }> = {
  chat:     { bg: '#E8F5E9', text: '#2E7D32', icon: '#4CAF50' },
  question: { bg: '#E3F2FD', text: '#1565C0', icon: '#1E88E5' },
  info:     { bg: '#FFF8E1', text: '#E65100', icon: '#FB8C00' },
  exercise: { bg: '#FCE4EC', text: '#880E4F', icon: '#E91E63' },
  cheer:    { bg: '#EDE7F6', text: '#4527A0', icon: '#7B1FA2' },
};

/*
 * ⚠️ 제목(heading)에는 반드시 flexDirection:'column' 을 같이 넣을 것.
 *
 * react-native-markdown-display 는 제목을 <Text> 가 아니라 **<View>** 로 그리고,
 * 그 기본 스타일이 `flexDirection: 'row'` 다(lib/styles.js heading1~6). 가로 상자 안에 든
 * 글자는 flex 가 없으면 "제 폭만큼"으로 잡히는데, 안드로이드/iOS 의 굵은 글씨 폭 측정이
 * 실제 그려지는 폭보다 조금 작게 나오는 경우가 있어 **뒷글자가 잘려 나간다.**
 *
 * 실제로 2026-08-16 오너가 발견: 소식 글의 `### 🔍 이렇게 나왔습니다` 가 화면에
 * **"🔍 이렇게"** 까지만 보였다. `##`(heading2)로 쓴 글 1편만 멀쩡했고 `###`(heading3)로
 * 쓴 3편이 전부 같은 자리에서 잘렸다 — 잘리고 말고는 글자 길이·굵기에 따라 갈리는
 * 운이라, heading2 가 지금 멀쩡한 것도 우연이다. 그래서 6단계 전부에 걸어 둔다.
 * (본문 데이터·마크다운 파싱은 멀쩡했다 — 순전히 그리는 단계 문제였다.)
 *
 * column 으로 바꾸면 글자 상자가 폭을 꽉 채워 정상적으로 줄바꿈된다.
 */
const HEADING_BLOCK = { flexDirection: 'column' as const };

// 파킨온 소식(is_news) 글 본문 렌더링 스타일 — postContent(18sp/#222222)와 크기·색을 맞추고,
// 웹 원문의 ##/### 제목·강조·인용을 60대 타겟 기준(고대비·큰 글씨)으로 옮긴다.
const markdownStyles = {
  body: { fontSize: 18, color: '#222222', lineHeight: 30 },
  // 오너 요청(2026-08-10): 처음엔 녹색을 시도했으나 "제목이 녹색이니까 더 정신없다"는 피드백
  // → 색은 원래대로 두고 두께만 최대(900)로 키워 구분을 강화.
  // marginTop 0 — 원래 20이었는데 "소식 N" 라벨(paragraph, marginBottom 14) 바로 다음에
  // 오면 14+20=34px로 너무 벌어져 보였다(오너 반복 지적, 2026-08-10). 문단 간 기본 간격(14)과
  // 맞춰서 라벨이든 일반 문단이든 뒤에 오는 제목과의 간격이 일정해지게 함.
  heading1: { ...HEADING_BLOCK, fontSize: 23, fontWeight: '900' as const, color: '#111111', marginTop: 0, marginBottom: 10 },
  heading2: { ...HEADING_BLOCK, fontSize: 21, fontWeight: '900' as const, color: '#111111', marginTop: 0, marginBottom: 8 },
  heading3: { ...HEADING_BLOCK, fontSize: 19, fontWeight: '700' as const, color: '#111111', marginTop: 16, marginBottom: 6 },
  heading4: { ...HEADING_BLOCK, fontSize: 18, fontWeight: '700' as const, color: '#111111', marginTop: 14, marginBottom: 6 },
  heading5: { ...HEADING_BLOCK, fontSize: 18, fontWeight: '700' as const, color: '#111111', marginTop: 14, marginBottom: 6 },
  heading6: { ...HEADING_BLOCK, fontSize: 18, fontWeight: '700' as const, color: '#111111', marginTop: 14, marginBottom: 6 },
  strong: { fontWeight: '700' as const, color: '#111111' },
  // "소식 N" 킥커 라벨 전용 — 본문에 실제 기울임체가 없어서 *기울임* 문법을 빌려 쓴다
  // (sync-news-posts.mjs 참고). fontStyle:'normal'로 기울임은 취소하고 웹 story-kicker와
  // 같은 녹색·굵게·작게로.
  em: { fontStyle: 'normal' as const, color: Colors.primary, fontWeight: '800' as const, fontSize: 13 },
  paragraph: { marginTop: 0, marginBottom: 14 },
  blockquote: {
    backgroundColor: '#E8F5E9',
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 10,
  },
  bullet_list_icon: { color: Colors.primary },
  link: { color: Colors.primary, textDecorationLine: 'underline' as const },
  // 소재 구분선(---) — 기본값은 위아래 여백이 거의 없어 다음 "소식 N" 라벨이 선에 붙어
  // 보였다(오너 지적 2026-08-10). 웹의 story-head 구분선(위 48px·아래 32px)과 비슷하게.
  hr: { backgroundColor: '#E0E0E0', height: 2, marginTop: 32, marginBottom: 20 },

  /*
   * 표 — 라이브러리 기본값에는 글자 크기가 없어서 본문(18sp)보다 작게 나오고 셀 여백도 거의
   * 없다(오너 지적 2026-08-25: "표는 저게 디자인이 맞냐? 왜이리 별로지?" — 소식 #8 재활 3종 표).
   * 웹 본문 표(.article-body table: 머리행 회색 배경·굵게, 셀 padding 12/14, 위 정렬)와
   * 같은 얼굴로 맞추되, 크기는 60대 타깃 기준으로 본문과 같은 18sp 를 쓴다.
   */
  table: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    overflow: 'hidden' as const,
    marginVertical: 14,
  },
  thead: { backgroundColor: '#F5F5F5' },
  th: { fontWeight: '700' as const, color: '#555555' },
  tr: { borderBottomWidth: 1, borderColor: '#E0E0E0', flexDirection: 'row' as const },
  td: { flex: 1, padding: 12 },
  /* 셀 안 글자 — td 에 fontSize 를 줘도 안쪽 텍스트에 안 먹는 경우가 있어 body 와 같은 값을
     여기서도 명시한다. 표는 줄이 길어지므로 행간만 본문(30)보다 조금 좁게 둔다. */
  table_cell_text: { fontSize: 18, color: '#222222', lineHeight: 26 },
};
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useDelayedFlag } from '../../hooks/useDelayedFlag';
import i18n from '../../i18n';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { ImageGalleryViewer } from '../../components/common/ImageGalleryViewer';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { CenterToast } from '../../components/common/CenterToast';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { ensureNotBanned, isBanRlsError, showBannedDialog, isBannedUser } from '../../utils/banGuard';
import { ReportSheet, ReportTargetType } from '../../components/feed/ReportSheet';
import { useBlocks } from '../../hooks/useBlocks';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import Markdown from 'react-native-markdown-display';
import * as WebBrowser from 'expo-web-browser';

type RouteProps = NativeStackScreenProps<FeedStackParamList, 'PostDetail'>['route'];
type NavProp = NativeStackNavigationProp<FeedStackParamList>;

interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  like_count: number;
  created_at: string;
  author: { name: string } | null;
  /** 운영자 댓글 표시 이름 — 있으면 실제 계정명 대신 이걸 쓴다(공지글과 같은 규칙). */
  author_name_override: string | null;
}

interface CommentDisplay {
  id: string;
  author: string;
  authorId: string;
  timeAgo: string;
  content: string;
  likeCount: number;
  replies: ReplyDisplay[];
}

interface ReplyDisplay {
  id: string;
  author: string;
  authorId: string;
  timeAgo: string;
  content: string;
  likeCount: number;
}

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
function formatTimeAgo(isoString: string): string {
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

/**
 * 표시할 작성자명.
 * 운영자 댓글은 실제 계정명 대신 관리자가 지정한 이름(author_name_override)을 쓴다 —
 * 공지글(posts.author_name_override)과 같은 규칙이다.
 */
function commentAuthorName(c: CommentRow): string {
  return c.author_name_override || c.author?.name || i18n.t('feed.authorUnknown');
}

function buildCommentTree(rows: CommentRow[]): CommentDisplay[] {
  const topLevel = rows.filter((r) => r.parent_id === null);
  return topLevel.map((c) => ({
    id: c.id,
    author: commentAuthorName(c),
    authorId: c.author_id,
    timeAgo: formatTimeAgo(c.created_at),
    content: c.content,
    likeCount: c.like_count,
    replies: rows
      .filter((r) => r.parent_id === c.id)
      .map((r) => ({
        id: r.id,
        author: commentAuthorName(r),
        authorId: r.author_id,
        timeAgo: formatTimeAgo(r.created_at),
        content: r.content,
        likeCount: r.like_count,
      })),
  }));
}

export function PostDetailScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProp>();
  const { post } = route.params;
  const { user, signOut } = useAuth();
  const { toastMsg, toastVisible, showToast } = useToast();
  const dialog = useDialog();
  // 스크롤 맨 아래 댓글 입력칸이 안드 3버튼/홈 인디케이터에 가리지 않도록 (글로벌 규칙)
  const bottomPad = useBottomSheetPadding(16);
  // 입력칸 포커스 시 키보드 위로 끌어올리기 위한 ScrollView ref
  const scrollViewRef = useRef<ScrollView>(null);
  // 안드로이드 edge-to-edge(Expo SDK 54+)에서는 키보드가 창을 리사이즈하지 않고 inset으로 들어와
  // adjustResize/automaticallyAdjustKeyboardInsets만으로는 흐름 안 입력칸이 가려진다.
  // → 키보드 높이를 직접 받아 ScrollView 맨 아래에 그만큼 여백(스페이서)을 주고 scrollToEnd 로 입력칸을 키보드 위로 올린다. (iOS는 automaticallyAdjustKeyboardInsets 가 처리하므로 안드만)
  const [kbHeight, setKbHeight] = useState(0);
  // 키보드가 떠 있는 동안에는 안전영역(홈 인디케이터/3버튼 내비)을 키보드가 이미 덮는다.
  // 그때까지 bottomPad(= 안전영역+16, 아이폰 기준 50px)를 그대로 두면 입력칸과 키보드
  // 사이에 그만큼이 빈 공간으로 남는다 — 그래서 키보드가 뜬 동안만 여백을 줄인다.
  const [kbVisible, setKbVisible] = useState(false);
  useEffect(() => {
    const isAndroid = Platform.OS === 'android';
    const showEvt = isAndroid ? 'keyboardDidShow' : 'keyboardWillShow';
    const hideEvt = isAndroid ? 'keyboardDidHide' : 'keyboardWillHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKbVisible(true);
      if (!isAndroid) return;
      setKbHeight(e.endCoordinates?.height ?? 0);
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      setKbVisible(false);
      if (isAndroid) setKbHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  /** 입력칸 하단 여백 — 키보드가 떠 있으면 최소값만, 닫혀 있으면 안전영역만큼. */
  const inputBottomPad = kbVisible ? 8 : bottomPad;

  const isOwner = !!(user && post.authorId && user.id === post.authorId);

  const [postTitle, setPostTitle] = useState(post.title);
  const [postContent, setPostContent] = useState(post.preview);

  // 포커스 시 최신 본문 갱신 (수정 후 돌아왔을 때 즉시 반영)
  useFocusEffect(
    useCallback(() => {
      supabase
        .from('posts')
        .select('title, content')
        .eq('id', post.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setPostTitle(data.title);
            setPostContent(data.content);
          }
        });
    }, [post.id])
  );

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [isBookmarked, setIsBookmarked] = useState(post.isBookmarked ?? false);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<CommentDisplay[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  /** 댓글을 한 번이라도 받아왔는지 — 스켈레톤을 첫 로드에만 띄우기 위한 표시. */
  const commentsLoadedRef = useRef(false);
  // 빨리 오면 스켈레톤을 아예 띄우지 않는다(회색 바 깜빡임 방지).
  const showCommentSkeleton = useDelayedFlag(commentsLoading);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // 신고·차단 (App Store 1.2 UGC)
  const { blockedIds, blockUser } = useBlocks();
  const [reportTarget, setReportTarget] = useState<{ type: ReportTargetType; id: string } | null>(null);

  // 수정하기
  const handleEdit = () => {
    navigation.navigate('PostWrite', {
      postId: post.id,
      initialTitle: postTitle,
      initialContent: postContent,
      initialCategory: post.categoryId ?? post.category,
      initialPhotos: mediaUrls,
      onSave: (newPhotos: string[]) => {
        setMediaUrls(newPhotos);
      },
    });
  };

  // 삭제하기
  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: t('postDetail.deleteConfirmTitle'),
      message: t('postDetail.deleteConfirmMsg'),
      confirmText: t('postDetail.deleteConfirmBtn'),
      cancelText: t('postDetail.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('posts')
        .delete()
        .eq('id', post.id);
      if (error) throw error;
      await dialog.alert({
        title: t('postDetail.deleteDoneTitle'),
        message: t('postDetail.deleteDoneMsg'),
      });
      navigation.goBack();
    } catch (e: any) {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: e.message ?? t('postDetail.deleteFailMsg') });
      console.error('[PostDetail] handleDelete 오류:', e);
    } finally {
      setDeleting(false);
    }
  };

  // 더보기 메뉴
  const handleMore = async () => {
    const id = await dialog.show({
      title: t('postDetail.manageTitle'),
      buttons: [
        { id: 'edit', text: t('postDetail.editAction') },
        { id: 'delete', text: t('postDetail.deleteAction'), style: 'destructive' },
        { id: 'cancel', text: t('postDetail.cancel'), style: 'cancel' },
      ],
    });
    if (id === 'edit') handleEdit();
    else if (id === 'delete') handleDelete();
  };

  // 사용자 차단 (작성한 글·댓글이 보이지 않음)
  const handleBlockUser = async (blockedId: string | undefined, name: string) => {
    if (!blockedId) return;
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const ok = await dialog.confirm({
      title: t('postDetail.blockUserTitle'),
      message: t('postDetail.blockUserMsg', { name }),
      confirmText: t('postDetail.blockUserBtn'),
      cancelText: t('postDetail.cancel'),
      destructive: true,
    });
    if (!ok) return;
    const success = await blockUser(blockedId);
    if (success) {
      await dialog.alert({ title: t('postDetail.blockDoneTitle'), message: t('postDetail.blockDoneMsg') });
      // 게시글 작성자를 차단했으면 목록으로 돌아감
      if (blockedId === post.authorId) {
        navigation.goBack();
      } else {
        // 댓글 작성자 차단 → 댓글 목록 즉시 갱신(필터는 렌더 단계에서 적용)
        fetchComments();
      }
    } else {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: t('postDetail.blockFailMsg') });
    }
  };

  // 타인 게시글 더보기 (신고/차단)
  const handlePostMoreOther = async () => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const id = await dialog.show({
      title: t('postDetail.postMenuTitle'),
      buttons: [
        { id: 'report', text: t('postDetail.reportAction') },
        { id: 'block', text: t('postDetail.blockAction'), style: 'destructive' },
        { id: 'cancel', text: t('postDetail.cancel'), style: 'cancel' },
      ],
    });
    if (id === 'report') setReportTarget({ type: 'post', id: post.id });
    else if (id === 'block') handleBlockUser(post.authorId, post.author);
  };

  // 타인 댓글/대댓글 더보기 (신고/차단)
  const handleCommentMoreOther = async (commentId: string, authorId: string, authorName: string) => {
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const id = await dialog.show({
      title: t('postDetail.commentMenuTitle'),
      buttons: [
        { id: 'report', text: t('postDetail.reportAction') },
        { id: 'block', text: t('postDetail.blockAction'), style: 'destructive' },
        { id: 'cancel', text: t('postDetail.cancel'), style: 'cancel' },
      ],
    });
    if (id === 'report') setReportTarget({ type: 'comment', id: commentId });
    else if (id === 'block') handleBlockUser(authorId, authorName);
  };

  // 첨부 사진 목록 조회 (post.id 만 의존 — 마운트 시 아래 댓글/북마크/좋아요
  // 조회와 동시에 시작되어 병렬로 로드된다).
  useEffect(() => {
    let alive = true;
    supabase
      .from('post_media')
      .select('r2_url, sort_order')
      .eq('post_id', post.id)
      .eq('media_type', 'image')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (alive && data && data.length > 0) {
          setMediaUrls(data.map((m) => m.r2_url));
        }
      });
    return () => {
      alive = false;
    };
  }, [post.id]);

  // 조회수 increment (RPC 실패 시 직접 update 폴백)
  useEffect(() => {
    const incrementView = async () => {
      const { error: rpcError } = await supabase.rpc('increment_view_count', { post_id: post.id });
      if (rpcError) {
        // RPC 없으면 직접 view_count + 1
        const { data: current } = await supabase
          .from('posts')
          .select('view_count')
          .eq('id', post.id)
          .single();
        if (current) {
          await supabase
            .from('posts')
            .update({ view_count: (current.view_count ?? 0) + 1 })
            .eq('id', post.id);
        }
      }
    };
    incrementView();
  }, [post.id]);

  // 북마크 + 좋아요 상태를 병렬 초기 조회 (개별 useEffect → Promise.all 로 묶음).
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const loadBookmark = supabase
      .from('post_bookmarks')
      .select('post_id')
      .eq('post_id', post.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setIsBookmarked(!!data);
      });
    const loadLiked = supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', post.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setLiked(!!data);
      });
    Promise.all([loadBookmark, loadLiked]);
    return () => {
      alive = false;
    };
  }, [post.id, user]);

  // 북마크 토글
  const toggleBookmark = async () => {
    if (!user) return;
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const next = !isBookmarked;
    setIsBookmarked(next);
    if (next) {
      await supabase.from('post_bookmarks').insert({ user_id: user.id, post_id: post.id });
      showToast(t('postDetail.bookmarkOn'));
    } else {
      await supabase.from('post_bookmarks').delete()
        .eq('user_id', user.id).eq('post_id', post.id);
      showToast(t('postDetail.bookmarkOff'));
    }
  };

  // 댓글 불러오기
  const fetchComments = useCallback(async () => {
    // 스켈레톤은 "아직 아무것도 못 받았을 때"만 띄운다.
    //   댓글을 달고 나서(재조회)나 화면에 다시 들어올 때마다 스켈레톤이 뜨면
    //   이미 읽던 댓글이 사라졌다 나타나 화면이 덜컥거린다.
    if (!commentsLoadedRef.current) setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:public_user_profiles(name)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(buildCommentTree((data ?? []) as CommentRow[]));
      commentsLoadedRef.current = true;
    } catch (e: any) {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: t('postDetail.commentsLoadFailMsg') });
      console.error('[PostDetail] fetchComments 오류:', e);
    } finally {
      setCommentsLoading(false);
    }
  }, [post.id]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // 좋아요 toggle
  const handleLike = async () => {
    if (!user) return;
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    const prevLiked = liked;
    const prevCount = likeCount;
    const nextLiked = !liked;
    // 낙관적 업데이트 (UX)
    setLiked(nextLiked);
    setLikeCount(nextLiked ? likeCount + 1 : likeCount - 1);

    try {
      if (nextLiked) {
        const { error } = await supabase
          .from('post_likes')
          .upsert({ post_id: post.id, user_id: user.id }, { onConflict: 'post_id,user_id' });
        if (error) throw error;
        showToast(t('postDetail.likeOn'));
      } else {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', user.id);
        if (error) throw error;
        showToast(t('postDetail.likeOff'));
      }
      // DB 트리거(sync_post_like_count)가 like_count를 자동 계산하므로
      // 클라이언트 계산값 대신 DB 실제 값으로 동기화
      const { data: postData } = await supabase
        .from('posts')
        .select('like_count')
        .eq('id', post.id)
        .single();
      if (postData != null) {
        setLikeCount(postData.like_count ?? 0);
      }
    } catch (e: any) {
      // 에러 시 롤백
      setLiked(prevLiked);
      setLikeCount(prevCount);
      await dialog.alert({ title: t('postDetail.errorTitle'), message: t('postDetail.likeFailMsg') });
      console.error('[PostDetail] handleLike 오류:', e);
    }
  };

  // 댓글/대댓글 등록
  const handleCommentSubmit = async () => {
    if (!user || !commentText.trim()) return;
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    if (ensureNotBanned(user, dialog)) return;
    setSubmittingComment(true);
    try {
      const { error } = await supabase.from('comments').insert({
        post_id: post.id,
        author_id: user.id,
        parent_id: replyingTo ?? null,
        content: commentText.trim(),
      });
      if (error) throw error;
      setCommentText('');
      setReplyingTo(null);
      Keyboard.dismiss();
      // 댓글 목록 갱신
      await fetchComments();
      // posts 테이블 comment_count 동기화
      const { count: totalComments } = await supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', post.id);
      if (totalComments != null) {
        await supabase
          .from('posts')
          .update({ comment_count: totalComments })
          .eq('id', post.id);
      }
    } catch (e: any) {
      // 밴된 계정의 INSERT 거부(RLS 42501) → 일반 오류 대신 이용 제한 안내
      if (isBanRlsError(e)) {
        showBannedDialog(dialog);
      } else {
        await dialog.alert({ title: t('postDetail.errorTitle'), message: e.message ?? t('postDetail.commentFailMsg') });
      }
      console.error('[PostDetail] handleCommentSubmit 오류:', e);
    } finally {
      setSubmittingComment(false);
    }
  };

  // 댓글 좋아요
  const handleCommentLike = async (commentId: string) => {
    if (!user) return;
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    try {
      const { data: existing } = await supabase
        .from('comment_likes')
        .select('id')
        .eq('comment_id', commentId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('comment_likes')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('comment_likes')
          .upsert({ comment_id: commentId, user_id: user.id }, { onConflict: 'comment_id,user_id' });
      }
      await fetchComments();
    } catch (e: any) {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: t('postDetail.commentLikeFailMsg') });
      console.error('[PostDetail] handleCommentLike 오류:', e);
    }
  };

  // 댓글/대댓글 수정 시작 — 본문 Text를 TextInput으로 바꿔치기 (인라인 수정)
  const handleCommentEditStart = (commentId: string, content: string) => {
    setEditingCommentId(commentId);
    setEditCommentText(content);
  };

  const handleCommentEditCancel = () => {
    setEditingCommentId(null);
    setEditCommentText('');
  };

  const handleCommentEditSave = async (commentId: string) => {
    const trimmed = editCommentText.trim();
    if (!trimmed) return;
    setSavingCommentEdit(true);
    try {
      const { error } = await supabase
        .from('comments')
        .update({ content: trimmed })
        .eq('id', commentId);
      if (error) throw error;
      setEditingCommentId(null);
      setEditCommentText('');
      await fetchComments();
    } catch (e: any) {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: e.message ?? t('postDetail.commentEditFailMsg') });
      console.error('[PostDetail] handleCommentEditSave 오류:', e);
    } finally {
      setSavingCommentEdit(false);
    }
  };

  // 댓글/대댓글 삭제 (본인 작성분) — 대댓글이 딸린 댓글을 지우면 DB의 on delete cascade로 답글도 함께 삭제된다
  const handleCommentDelete = async (commentId: string, hasReplies: boolean) => {
    const ok = await dialog.confirm({
      title: t('postDetail.commentDeleteConfirmTitle'),
      message: hasReplies
        ? t('postDetail.commentDeleteConfirmMsgWithReplies')
        : t('postDetail.commentDeleteConfirmMsg'),
      confirmText: t('postDetail.deleteConfirmBtn'),
      cancelText: t('postDetail.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId);
      if (error) throw error;
      await fetchComments();
      // posts 테이블 comment_count 동기화 (등록 때와 동일한 방식)
      const { count: totalComments } = await supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('post_id', post.id);
      if (totalComments != null) {
        await supabase
          .from('posts')
          .update({ comment_count: totalComments })
          .eq('id', post.id);
      }
    } catch (e: any) {
      await dialog.alert({ title: t('postDetail.errorTitle'), message: e.message ?? t('postDetail.commentDeleteFailMsg') });
      console.error('[PostDetail] handleCommentDelete 오류:', e);
    }
  };

  // 차단한 사용자의 댓글·대댓글 제외 (클라이언트 필터, OTA 안전)
  const visibleComments: CommentDisplay[] = comments
    .filter((c) => !blockedIds.has(c.authorId))
    .map((c) => ({
      ...c,
      replies: c.replies.filter((r) => !blockedIds.has(r.authorId)),
    }));

  // 댓글 + 대댓글 합산 (차단 제외 후)
  const totalCommentCount = visibleComments.reduce((acc, c) => acc + 1 + c.replies.length, 0);

  // 카테고리 라벨/색상 결정 (색상은 categoryId 기준 — 로케일에 안전)
  const categoryLabel = post.isNews ? (post.newsTag ?? t('feed.newsBadge')) : (post.category ?? t('feed.typeChat'));
  const categoryColor = CATEGORY_COLORS_BY_ID[post.isNews ? 'info' : (post.categoryId ?? 'chat')] ?? CATEGORY_COLORS_BY_ID.chat;

  // 파킨온 소식 글: 히어로 이미지를 "소식 1"과 "소식 2" 사이에 끼워 넣기 위한 본문 분할.
  // sync-news-posts.mjs가 두 번째 이상 소재마다 "\n---\n\n"을 앞에 붙여 내보내므로,
  // 그 첫 번째 등장 지점이 곧 소식1↔소식2 경계다(소식2 뒤에도 "지금 할 수 있는 것" 앞에
  // 구분선이 하나 더 있지만 그건 두 번째 등장이라 영향 없음). 소재가 하나뿐인 글(구분선 없음)은
  // 이미지를 본문 맨 뒤에 그대로 둔다.
  // 이 경계에 있던 "---" 구분선은 이제 이미지 자체가 소식1/소식2를 갈라주므로 앱에서만 제거한다
  // (사이트는 이미지가 이 자리에 없으니 구분선을 그대로 둔다 — sync-news-posts.mjs·mdx는 안 건드림).
  const newsHeroSplitIdx = post.isNews ? postContent.indexOf('\n---\n\n') : -1;
  const newsBodyBeforeHero = newsHeroSplitIdx >= 0 ? postContent.slice(0, newsHeroSplitIdx) : postContent;
  const newsBodyAfterHero =
    newsHeroSplitIdx >= 0 ? postContent.slice(newsHeroSplitIdx).replace(/^\n---\n+/, '') : '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('postDetail.title')}
        showBack
        rightComponent={
          isOwner ? (
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity
                onPress={handleEdit}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: '#F0F0F0',
                  marginRight: 4,
                }}
              >
                <Text style={{ fontSize: 14, color: '#555' }}>{t('postDetail.edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDelete}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: '#FFF0F0',
                }}
              >
                <Text style={{ fontSize: 14, color: '#F44336' }}>{t('postDetail.delete')}</Text>
              </TouchableOpacity>
            </View>
          ) : (!post.isNews && post.authorId) ? (
            <TouchableOpacity
              onPress={handlePostMoreOther}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: '#F0F0F0',
              }}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#555" />
              <Text style={{ fontSize: 14, color: '#555' }}>{t('postDetail.more')}</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // iOS는 키보드 높이만큼 자동으로 하단 인셋을 잡아 입력칸이 가려지지 않게 함 (RN 0.70+)
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
          {/* 본문·댓글 빈 공간 탭 시 키보드 닫기 (60대 타겟 명시적 닫기 수단) */}
          <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()} accessible={false}>
          <View>

          {/* ── 게시글 본문 카드 ── */}
          <View style={styles.postCard}>

            {/* 카테고리 뱃지 (pill) */}
            <View style={[styles.categoryPill, { backgroundColor: categoryColor.bg }]}>
              <Ionicons
                name={post.isNews ? 'newspaper-outline' : post.categoryIcon}
                size={14}
                color={categoryColor.icon}
              />
              <Text style={[styles.categoryPillText, { color: categoryColor.text }]}>
                {categoryLabel}
              </Text>
            </View>

            {/* 제목 */}
            <Text style={styles.postTitle}>{postTitle}</Text>

            {/* 작성자 + 날짜 */}
            <Text style={styles.postMeta}>
              {post.author}
              {post.authorRole ? ` · ${post.authorRole}` : ''}
              {'  '}
              {post.date}
            </Text>

            {/* 구분선 */}
            <View style={styles.metaDivider} />

            {/* 본문 — 파킨온 소식 글은 웹사이트 원문을 마크다운으로 그대로 옮겨온 전문이라 서식이 있다.
                히어로 이미지는 "소식 1"과 "소식 2" 사이에 끼워 넣는다(구분선 없는 단일 소재 글은 뒤에). */}
            {post.isNews ? (
              <>
                <Markdown style={markdownStyles}>{newsBodyBeforeHero}</Markdown>
                {newsHeroSplitIdx >= 0 && (
                  <View style={styles.newsHeroImageWrap}>
                    <ImageGalleryViewer urls={mediaUrls} publicCommunity imageAspectRatio={16 / 9} />
                  </View>
                )}
                {newsBodyAfterHero !== '' && (
                  <Markdown style={markdownStyles}>{newsBodyAfterHero}</Markdown>
                )}
              </>
            ) : (
              <Text style={styles.postContent}>{postContent}</Text>
            )}

            {/* 첨부 사진 갤러리 (전체보기 + 인디케이터 포함) — 소식 글은 위에서 이미 넣었으므로 제외 */}
            {!post.isNews && <ImageGalleryViewer urls={mediaUrls} publicCommunity />}
            {post.isNews && newsHeroSplitIdx < 0 && (
              <ImageGalleryViewer urls={mediaUrls} publicCommunity imageAspectRatio={16 / 9} />
            )}

            {/* 파킨온 소식 글 하단 — 웹사이트로 연결(홍보 겸 원문 출처 표시). 박스 없이 주황 텍스트 링크로. */}
            {post.isNews && post.newsUrl && (
              <TouchableOpacity
                style={styles.newsPromoBanner}
                onPress={() => WebBrowser.openBrowserAsync(post.newsUrl!)}
                activeOpacity={0.8}
              >
                <Ionicons name="globe-outline" size={18} color={Colors.accent} />
                <Text style={styles.newsPromoText}>{t('postDetail.newsPromoLink')}</Text>
                <Ionicons name="open-outline" size={15} color={Colors.accent} style={styles.newsPromoIcon} />
              </TouchableOpacity>
            )}
          </View>

          {/* ── 통계 바 ── */}
          <View style={styles.statsCard}>
            <TouchableOpacity style={styles.statItem} onPress={handleLike} activeOpacity={0.7}>
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={22}
                color={liked ? Colors.danger : '#888'}
              />
              <Text style={[styles.statLabel, liked && { color: Colors.danger }]}>
                {t('postDetail.likeCount', { count: likeCount })}
              </Text>
            </TouchableOpacity>

            <View style={styles.statSep} />

            <View style={styles.statItem}>
              <Ionicons name="chatbubble-outline" size={20} color="#888" />
              <Text style={styles.statLabel}>{t('postDetail.commentCount', { count: totalCommentCount })}</Text>
            </View>

            <View style={styles.statSep} />

            <View style={styles.statItem}>
              <Ionicons name="eye-outline" size={20} color="#888" />
              <Text style={styles.statLabel}>{t('postDetail.viewsCount', { count: post.views })}</Text>
            </View>

            <View style={styles.statSep} />

            <TouchableOpacity style={styles.statItem} onPress={toggleBookmark} activeOpacity={0.7}>
              <Ionicons
                name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={22}
                color={isBookmarked ? Colors.primary : '#888'}
              />
              <Text style={[styles.statLabel, isBookmarked && { color: Colors.primary }]}>
                {t('postDetail.bookmark')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 댓글 섹션 ── */}
          <View style={styles.commentHeader}>
            <Text style={styles.commentTitle}>{t('postDetail.commentsHeader', { count: totalCommentCount })}</Text>
          </View>

          {showCommentSkeleton ? (
            <View style={styles.skelCommentWrap}>
              {[0, 1].map((i) => (
                <View key={i} style={styles.skelCommentCard}>
                  <View style={styles.skelLineShort} />
                  <View style={[styles.skelLine, { marginTop: 10 }]} />
                  <View style={[styles.skelLine, { width: '70%', marginTop: 6 }]} />
                </View>
              ))}
            </View>
          ) : (
            visibleComments.map((comment) => {
              const commentIsOwner = !!(user && comment.authorId && user.id === comment.authorId);
              return (
              <View key={comment.id} style={styles.commentItem}>
                {/* 댓글 */}
                <View style={styles.commentCard}>
                  <View style={styles.commentTop}>
                    <Text style={styles.commentAuthor}>{comment.author}</Text>
                    <Text style={styles.commentTime}>{comment.timeAgo}</Text>
                  </View>
                  {editingCommentId === comment.id ? (
                    <View>
                      <TextInput
                        style={styles.commentEditInput}
                        value={editCommentText}
                        onChangeText={setEditCommentText}
                        multiline
                        maxLength={500}
                        autoFocus
                      />
                      <View style={styles.commentEditActionRow}>
                        <TouchableOpacity
                          style={styles.commentEditCancelBtn}
                          onPress={handleCommentEditCancel}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.commentEditCancelText}>{t('postDetail.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.commentEditSaveBtn,
                            (!editCommentText.trim() || savingCommentEdit) && styles.commentSubmitDisabled,
                          ]}
                          onPress={() => handleCommentEditSave(comment.id)}
                          disabled={!editCommentText.trim() || savingCommentEdit}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.commentEditSaveText}>{t('postDetail.commentEditSave')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.commentContent}>{comment.content}</Text>
                  )}
                  <View style={styles.commentActions}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleCommentLike(comment.id)}
                    >
                      <View style={styles.actionRow}>
                        <Ionicons name="heart-outline" size={16} color={Colors.textSub} />
                        <Text style={styles.actionText}>{comment.likeCount}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                    >
                      <Text style={styles.actionText}>
                        {replyingTo === comment.id ? t('postDetail.replyCancel') : t('postDetail.replyAction')}
                      </Text>
                    </TouchableOpacity>
                    {commentIsOwner ? (
                      <>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleCommentEditStart(comment.id, comment.content)}
                        >
                          <View style={styles.actionRow}>
                            <Ionicons name="create-outline" size={16} color={Colors.textSub} />
                            <Text style={styles.actionText}>{t('postDetail.edit')}</Text>
                          </View>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleCommentDelete(comment.id, comment.replies.length > 0)}
                        >
                          <View style={styles.actionRow}>
                            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                            <Text style={[styles.actionText, { color: Colors.danger }]}>{t('postDetail.delete')}</Text>
                          </View>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleCommentMoreOther(comment.id, comment.authorId, comment.author)}
                      >
                        <View style={styles.actionRow}>
                          <Ionicons name="ellipsis-horizontal" size={16} color={Colors.textSub} />
                          <Text style={styles.actionText}>{t('postDetail.more')}</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* 대댓글 */}
                {comment.replies.map((reply) => {
                  const replyIsOwner = !!(user && reply.authorId && user.id === reply.authorId);
                  return (
                  <View key={reply.id} style={styles.replyCard}>
                    <Text style={styles.replyArrow}>└</Text>
                    <View style={styles.replyContent}>
                      <View style={styles.commentTop}>
                        <Text style={styles.commentAuthor}>{reply.author}</Text>
                        <Text style={styles.commentTime}>{reply.timeAgo}</Text>
                      </View>
                      {editingCommentId === reply.id ? (
                        <View>
                          <TextInput
                            style={styles.commentEditInput}
                            value={editCommentText}
                            onChangeText={setEditCommentText}
                            multiline
                            maxLength={500}
                            autoFocus
                          />
                          <View style={styles.commentEditActionRow}>
                            <TouchableOpacity
                              style={styles.commentEditCancelBtn}
                              onPress={handleCommentEditCancel}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.commentEditCancelText}>{t('postDetail.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.commentEditSaveBtn,
                                (!editCommentText.trim() || savingCommentEdit) && styles.commentSubmitDisabled,
                              ]}
                              onPress={() => handleCommentEditSave(reply.id)}
                              disabled={!editCommentText.trim() || savingCommentEdit}
                              activeOpacity={0.85}
                            >
                              <Text style={styles.commentEditSaveText}>{t('postDetail.commentEditSave')}</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.commentContent}>{reply.content}</Text>
                      )}
                      <View style={styles.commentActions}>
                        <TouchableOpacity
                          style={styles.actionBtn}
                          onPress={() => handleCommentLike(reply.id)}
                        >
                          <View style={styles.actionRow}>
                            <Ionicons name="heart-outline" size={16} color={Colors.textSub} />
                            <Text style={styles.actionText}>{reply.likeCount}</Text>
                          </View>
                        </TouchableOpacity>
                        {replyIsOwner ? (
                          <>
                            <TouchableOpacity
                              style={styles.actionBtn}
                              onPress={() => handleCommentEditStart(reply.id, reply.content)}
                            >
                              <View style={styles.actionRow}>
                                <Ionicons name="create-outline" size={16} color={Colors.textSub} />
                                <Text style={styles.actionText}>{t('postDetail.edit')}</Text>
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.actionBtn}
                              onPress={() => handleCommentDelete(reply.id, false)}
                            >
                              <View style={styles.actionRow}>
                                <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                                <Text style={[styles.actionText, { color: Colors.danger }]}>{t('postDetail.delete')}</Text>
                              </View>
                            </TouchableOpacity>
                          </>
                        ) : (
                          <TouchableOpacity
                            style={styles.actionBtn}
                            onPress={() => handleCommentMoreOther(reply.id, reply.authorId, reply.author)}
                          >
                            <View style={styles.actionRow}>
                              <Ionicons name="ellipsis-horizontal" size={16} color={Colors.textSub} />
                              <Text style={styles.actionText}>{t('postDetail.more')}</Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                  );
                })}
              </View>
              );
            })
          )}

          </View>
          </TouchableWithoutFeedback>

          {/* 댓글 입력창 (스크롤 흐름 안 맨 아래 — 떠있는 고정 바 없음. 포커스 시 키보드 위로 끌어올림) */}
          {isBannedUser(user) ? (
            <View style={[styles.commentInputArea, { paddingBottom: bottomPad }]}>
              <Text style={styles.bannedNotice}>
                {t('postDetail.bannedNotice')}
              </Text>
            </View>
          ) : (
          <View style={styles.commentInputArea}>
            {replyingTo && (
              <View style={styles.replyingBanner}>
                <Text style={[styles.replyingText, { flex: 1 }]}>
                  {t('postDetail.replyingTo', { name: comments.find((c) => c.id === replyingTo)?.author })}
                </Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)}>
                  <Text style={styles.replyCancelText}>{t('postDetail.cancel')}</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={[styles.commentInputRow, { paddingBottom: inputBottomPad }]}>
              <TextInput
                style={styles.commentInput}
                placeholder={replyingTo ? t('postDetail.replyPlaceholder') : t('postDetail.commentPlaceholder')}
                placeholderTextColor={Colors.textHint}
                value={commentText}
                onChangeText={setCommentText}
                onFocus={() => {
                  // 키보드 애니메이션이 끝난 뒤 입력칸을 키보드 바로 위로 끌어올림 (특히 안드 — automaticallyAdjustKeyboardInsets 미지원)
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 250);
                }}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.commentSubmitBtn,
                  (!commentText.trim() || submittingComment) && styles.commentSubmitDisabled,
                ]}
                onPress={handleCommentSubmit}
                disabled={!commentText.trim() || submittingComment}
              >
                <Text style={styles.commentSubmitText}>{t('postDetail.submit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          )}

          {/* 안드 edge-to-edge 키보드 가림 방지용 하단 스페이서 — 키보드 높이만큼 공간을 줘 입력칸이 키보드 위로 올라가게 함 */}
          {kbHeight > 0 && <View style={{ height: kbHeight }} />}
        </ScrollView>
      <CenterToast message={toastMsg} visible={toastVisible} />
      <ReportSheet
        visible={!!reportTarget}
        targetType={reportTarget?.type ?? 'post'}
        targetId={reportTarget?.id ?? ''}
        postId={post.id}
        onClose={() => setReportTarget(null)}
      />
      {deleting && (
        <View style={styles.deletingOverlay}>
          <ActivityIndicator size="large" color={Colors.white} />
          <Text style={styles.deletingText}>{t('postDetail.deleting')}</Text>
        </View>
      )}
      <BrandProgressOverlay
        visible={submittingComment}
        title={t('postDetail.submittingComment')}
        minVisibleMs={500}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── 기반 레이아웃 ──
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { paddingBottom: 0 },

  // ── 본문 카드 ──
  postCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 0,
    marginTop: 0,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },

  // 카테고리 pill 뱃지
  categoryPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 14,
  },
  categoryPillText: {
    fontSize: 14,
    fontWeight: '700',
  },

  // 제목
  postTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111111',
    lineHeight: 32,
    marginBottom: 10,
  },

  // 작성자 + 날짜
  postMeta: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 16,
  },

  // 제목-본문 구분선
  metaDivider: {
    height: 1,
    backgroundColor: '#EEEEEE',
    marginBottom: 18,
  },

  // 본문
  postContent: {
    fontSize: 18,
    color: '#222222',
    lineHeight: 30,
    marginBottom: 4,
  },
  // 소식 글 히어로 이미지 — 바로 아래 "소식 2" 라벨과 붙어 보여서 한 줄 정도 띄움
  newsHeroImageWrap: {
    marginBottom: 14,
  },
  newsPromoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 16,
    paddingVertical: 6,
  },
  newsPromoText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.accent,
  },
  newsPromoIcon: {
    marginLeft: -2,
  },

  // ── 통계 바 카드 ──
  statsCard: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 15,
    color: '#888888',
    fontWeight: '500',
    flexShrink: 1,
  },
  statSep: {
    width: 1,
    height: 18,
    backgroundColor: '#E0E0E0',
  },

  // ── 댓글 섹션 ──
  commentHeader: {
    backgroundColor: '#FFFFFF',
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  commentTitle: { fontSize: 18, fontWeight: '700', color: '#111111' },

  // ── 댓글 로딩 스켈레톤 ──
  skelCommentWrap: { paddingHorizontal: 20, paddingTop: 16 },
  skelCommentCard: {
    paddingBottom: 16,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  skelLine: { height: 15, borderRadius: 5, backgroundColor: '#ECECEC' },
  skelLineShort: { height: 14, width: '30%', borderRadius: 5, backgroundColor: '#F1F1F1' },

  commentItem: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  commentCard: {
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  // 작성자와 내용이 거의 같은 크기·색·굵기라 눈으로 구분이 안 됐다.
  //   읽어야 할 건 내용이므로, 작성자를 뒤로 물린다(회색·덜 굵게).
  //   ⚠️ 글자 크기는 줄이지 않는다 — 60대 이상 타겟이라 작아지면 안 보인다.
  //   구분은 '색과 굵기'로만 만든다.
  commentAuthor: { fontSize: 16, fontWeight: '600', color: '#888888' },
  commentTime: { fontSize: 13, color: '#AAAAAA' },
  // 내용은 반대로 더 진하게 — 작성자(#888)와 확실히 갈리게 한다.
  commentContent: { fontSize: 17, color: '#111111', lineHeight: 27, marginBottom: 10 },
  // 댓글 인라인 수정 — Text 자리에 그대로 끼워 넣는 TextInput + 저장/취소 버튼 행
  commentEditInput: {
    fontSize: 17,
    color: '#111111',
    lineHeight: 24,
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    maxHeight: 120,
  },
  commentEditActionRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  commentEditCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentEditCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSub },
  commentEditSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentEditSaveText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  commentActions: { flexDirection: 'row', gap: 18 },
  actionBtn: { paddingVertical: 2 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: 15, color: Colors.textSub },

  replyCard: {
    flexDirection: 'row',
    paddingTop: 14,
    paddingLeft: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  replyArrow: { fontSize: 18, color: '#BBBBBB', marginRight: 10, marginTop: 2 },
  replyContent: { flex: 1 },

  // ── 댓글 입력창 (스크롤 흐름 안 맨 아래) ──
  commentInputArea: {
    backgroundColor: Colors.white,
    marginTop: 8,
    paddingTop: 4,
  },
  bannedNotice: {
    fontSize: 17,
    lineHeight: 26,
    color: Colors.textSub,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F0F4FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DDEEFF',
  },
  replyingText: { fontSize: 15, color: '#444444' },
  replyCancelText: { fontSize: 15, color: Colors.textSub },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  commentInput: {
    flex: 1,
    fontSize: 17,
    color: Colors.text,
    backgroundColor: '#F5F5F5',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    maxHeight: 84,
  },
  commentSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 11,
    minWidth: 56,
    alignItems: 'center',
  },
  commentSubmitDisabled: { backgroundColor: Colors.border },
  commentSubmitText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  // ── 삭제 중 오버레이 ──
  deletingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    gap: 16,
  },
  deletingText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
});
