import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';

// 카테고리별 색상 매핑
const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  '자유수다':   { bg: '#E8F5E9', text: '#2E7D32', icon: '#4CAF50' },
  '질문있어요': { bg: '#E3F2FD', text: '#1565C0', icon: '#1E88E5' },
  '정보공유':   { bg: '#FFF8E1', text: '#E65100', icon: '#FB8C00' },
  '운동인증':   { bg: '#FCE4EC', text: '#880E4F', icon: '#E91E63' },
  '응원해요':   { bg: '#EDE7F6', text: '#4527A0', icon: '#7B1FA2' },
  '뉴스':       { bg: '#FFF3E0', text: '#BF360C', icon: '#FF6D00' },
};
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { ImageGalleryViewer } from '../../components/common/ImageGalleryViewer';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

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

function formatTimeAgo(isoString: string): string {
  const now = new Date();
  const past = new Date(isoString);
  const diff = Math.floor((now.getTime() - past.getTime()) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

function buildCommentTree(rows: CommentRow[]): CommentDisplay[] {
  const topLevel = rows.filter((r) => r.parent_id === null);
  return topLevel.map((c) => ({
    id: c.id,
    author: c.author?.name ?? '알 수 없음',
    authorId: c.author_id,
    timeAgo: formatTimeAgo(c.created_at),
    content: c.content,
    likeCount: c.like_count,
    replies: rows
      .filter((r) => r.parent_id === c.id)
      .map((r) => ({
        id: r.id,
        author: r.author?.name ?? '알 수 없음',
        authorId: r.author_id,
        timeAgo: formatTimeAgo(r.created_at),
        content: r.content,
        likeCount: r.like_count,
      })),
  }));
}

export function PostDetailScreen() {
  const route = useRoute<RouteProps>();
  const navigation = useNavigation<NavProp>();
  const { post } = route.params;
  const { user } = useAuth();

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
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);

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
  const handleDelete = () => {
    Alert.alert(
      '게시글 삭제',
      '정말 삭제하시겠어요?\n삭제된 글은 복구할 수 없어요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('posts')
                .delete()
                .eq('id', post.id);
              if (error) throw error;
              Alert.alert('삭제 완료', '게시글이 삭제되었어요.', [
                { text: '확인', onPress: () => navigation.goBack() },
              ]);
            } catch (e: any) {
              Alert.alert('오류', e.message ?? '삭제 중 문제가 생겼어요. 다시 시도해주세요.');
              console.error('[PostDetail] handleDelete 오류:', e);
            }
          },
        },
      ]
    );
  };

  // 더보기 메뉴
  const handleMore = () => {
    Alert.alert(
      '게시글 관리',
      '',
      [
        { text: '수정하기', onPress: handleEdit },
        { text: '삭제하기', style: 'destructive', onPress: handleDelete },
        { text: '취소', style: 'cancel' },
      ]
    );
  };

  // 첨부 사진 목록 조회
  useEffect(() => {
    supabase
      .from('post_media')
      .select('r2_url, sort_order')
      .eq('post_id', post.id)
      .eq('media_type', 'image')
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setMediaUrls(data.map((m) => m.r2_url));
        }
      });
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

  // 북마크 상태 초기 조회
  useEffect(() => {
    if (!user) return;
    supabase
      .from('post_bookmarks')
      .select('post_id')
      .eq('post_id', post.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsBookmarked(!!data));
  }, [post.id, user]);

  // 북마크 토글
  const toggleBookmark = async () => {
    if (!user) return;
    const next = !isBookmarked;
    setIsBookmarked(next);
    if (next) {
      await supabase.from('post_bookmarks').insert({ user_id: user.id, post_id: post.id });
    } else {
      await supabase.from('post_bookmarks').delete()
        .eq('user_id', user.id).eq('post_id', post.id);
    }
  };

  // 좋아요 상태 초기 조회
  useEffect(() => {
    if (!user) return;
    supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', post.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setLiked(!!data);
      });
  }, [post.id, user]);

  // 댓글 불러오기
  const fetchComments = useCallback(async () => {
    setCommentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:users(name)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(buildCommentTree((data ?? []) as CommentRow[]));
    } catch (e: any) {
      Alert.alert('오류', '댓글을 불러오지 못했어요. 다시 시도해주세요.');
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
    const nextLiked = !liked;
    // 낙관적 업데이트
    setLiked(nextLiked);
    const nextCount = nextLiked ? likeCount + 1 : likeCount - 1;
    setLikeCount(nextCount);

    try {
      if (nextLiked) {
        const { error } = await supabase
          .from('post_likes')
          .upsert({ post_id: post.id, user_id: user.id }, { onConflict: 'post_id,user_id' });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('post_likes')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', user.id);
        if (error) throw error;
      }
      // posts 테이블 like_count 동기화
      await supabase
        .from('posts')
        .update({ like_count: nextCount })
        .eq('id', post.id);
    } catch (e: any) {
      // 롤백
      setLiked(!nextLiked);
      setLikeCount(likeCount);
      Alert.alert('오류', '좋아요 처리 중 문제가 생겼어요. 다시 시도해주세요.');
      console.error('[PostDetail] handleLike 오류:', e);
    }
  };

  // 댓글/대댓글 등록
  const handleCommentSubmit = async () => {
    if (!user || !commentText.trim()) return;
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
      Alert.alert('오류', e.message ?? '댓글 등록 중 문제가 생겼어요. 다시 시도해주세요.');
      console.error('[PostDetail] handleCommentSubmit 오류:', e);
    } finally {
      setSubmittingComment(false);
    }
  };

  // 댓글 좋아요
  const handleCommentLike = async (commentId: string) => {
    if (!user) return;
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
      Alert.alert('오류', '좋아요 처리 중 문제가 생겼어요.');
      console.error('[PostDetail] handleCommentLike 오류:', e);
    }
  };

  // 카테고리 라벨 결정
  const categoryLabel = post.isNews ? '뉴스' : (post.category ?? '자유수다');
  const categoryColor = CATEGORY_COLORS[categoryLabel] ?? CATEGORY_COLORS['자유수다'];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="글 보기"
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
                <Text style={{ fontSize: 14, color: '#555' }}>수정</Text>
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
                <Text style={{ fontSize: 14, color: '#F44336' }}>삭제</Text>
              </TouchableOpacity>
            </View>
          ) : undefined
        }
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

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

            {/* 본문 */}
            <Text style={styles.postContent}>{postContent}</Text>

            {/* 첨부 사진 갤러리 (전체보기 + 인디케이터 포함) */}
            <ImageGalleryViewer urls={mediaUrls} />
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
                좋아요 {likeCount}
              </Text>
            </TouchableOpacity>

            <View style={styles.statSep} />

            <View style={styles.statItem}>
              <Ionicons name="chatbubble-outline" size={20} color="#888" />
              <Text style={styles.statLabel}>댓글 {comments.length}</Text>
            </View>

            <View style={styles.statSep} />

            <View style={styles.statItem}>
              <Ionicons name="eye-outline" size={20} color="#888" />
              <Text style={styles.statLabel}>조회 {post.views}</Text>
            </View>

            <View style={styles.statSep} />

            <TouchableOpacity style={styles.statItem} onPress={toggleBookmark} activeOpacity={0.7}>
              <Ionicons
                name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
                size={22}
                color={isBookmarked ? Colors.primary : '#888'}
              />
              <Text style={[styles.statLabel, isBookmarked && { color: Colors.primary }]}>
                즐겨찾기
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 댓글 섹션 ── */}
          <View style={styles.commentHeader}>
            <Text style={styles.commentTitle}>댓글 {comments.length}개</Text>
          </View>

          {commentsLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 20 }} />
          ) : (
            comments.map((comment) => (
              <View key={comment.id} style={styles.commentItem}>
                {/* 댓글 */}
                <View style={styles.commentCard}>
                  <View style={styles.commentTop}>
                    <Text style={styles.commentAuthor}>{comment.author}</Text>
                    <Text style={styles.commentTime}>{comment.timeAgo}</Text>
                  </View>
                  <Text style={styles.commentContent}>{comment.content}</Text>
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
                        {replyingTo === comment.id ? '취소' : '답글달기'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* 대댓글 */}
                {comment.replies.map((reply) => (
                  <View key={reply.id} style={styles.replyCard}>
                    <Text style={styles.replyArrow}>└</Text>
                    <View style={styles.replyContent}>
                      <View style={styles.commentTop}>
                        <Text style={styles.commentAuthor}>{reply.author}</Text>
                        <Text style={styles.commentTime}>{reply.timeAgo}</Text>
                      </View>
                      <Text style={styles.commentContent}>{reply.content}</Text>
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
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ))
          )}

          {/* 댓글 입력창 */}
          <View style={styles.commentInputArea}>
            {replyingTo && (
              <View style={styles.replyingBanner}>
                <Text style={styles.replyingText}>
                  {comments.find((c) => c.id === replyingTo)?.author}에게 답글 작성 중
                </Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)}>
                  <Text style={styles.replyCancelText}>취소</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder={replyingTo ? '답글을 입력해주세요' : '댓글을 입력해주세요'}
                placeholderTextColor={Colors.textHint}
                value={commentText}
                onChangeText={setCommentText}
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
                <Text style={styles.commentSubmitText}>
                  {submittingComment ? '...' : '등록'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── 기반 레이아웃 ──
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { paddingBottom: 24 },

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
  },
  statLabel: {
    fontSize: 15,
    color: '#888888',
    fontWeight: '500',
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
  commentAuthor: { fontSize: 16, fontWeight: '700', color: '#111111' },
  commentTime: { fontSize: 13, color: '#AAAAAA' },
  commentContent: { fontSize: 17, color: '#222222', lineHeight: 27, marginBottom: 10 },
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

  // ── 댓글 입력창 ──
  commentInputArea: {
    backgroundColor: Colors.white,
    marginTop: 8,
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
});
