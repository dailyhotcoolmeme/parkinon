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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type RouteProps = NativeStackScreenProps<FeedStackParamList, 'PostDetail'>['route'];

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
  const { post } = route.params;
  const { user } = useAuth();

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<CommentDisplay[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  // 조회수 increment
  useEffect(() => {
    supabase.rpc('increment_view_count', { post_id: post.id }).then(({ error }) => {
      if (error) console.warn('[PostDetail] 조회수 increment 실패:', error.message);
    });
  }, [post.id]);

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
    setLikeCount((prev) => (nextLiked ? prev + 1 : prev - 1));

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
    } catch (e: any) {
      // 롤백
      setLiked(!nextLiked);
      setLikeCount((prev) => (nextLiked ? prev - 1 : prev + 1));
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
      await fetchComments();
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="글 보기" showBack />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* 게시글 헤더 */}
          <View style={styles.postHeader}>
            <View style={styles.postMeta}>
              <Text style={styles.postAuthor}>{post.author}</Text>
              <Text style={styles.postDate}> · {post.date}</Text>
            </View>
            {post.isNews ? (
              <View style={styles.newsBadge}>
                <Ionicons name="newspaper-outline" size={13} color={Colors.accent} />
                <Text style={styles.newsBadgeText}>뉴스</Text>
              </View>
            ) : (
              <View style={styles.categoryBadge}>
                <Ionicons name={post.categoryIcon} size={13} color={Colors.dark} />
                <Text style={styles.categoryBadgeText}>{post.category}</Text>
              </View>
            )}
          </View>

          {/* 제목 */}
          <Text style={styles.postTitle}>{post.title}</Text>

          {/* 내용 */}
          <Text style={styles.postContent}>{post.preview}</Text>

          {/* 조회/좋아요 */}
          <View style={styles.statsRow}>
            <Text style={styles.statText}>조회 {post.views}</Text>
            <TouchableOpacity style={styles.likeBtn} onPress={handleLike} activeOpacity={0.7}>
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={22}
                color={liked ? Colors.danger : Colors.textSub}
              />
              <Text style={[styles.likeCount, liked && styles.likeCountActive]}>
                {likeCount}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* 댓글 섹션 */}
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
                        <Ionicons name="heart-outline" size={14} color={Colors.textSub} />
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
                            <Ionicons name="heart-outline" size={14} color={Colors.textSub} />
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
        </ScrollView>

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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1, backgroundColor: Colors.white },
  scrollContent: { paddingBottom: 20 },
  postHeader: {
    backgroundColor: Colors.white,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  postMeta: { flexDirection: 'row', alignItems: 'center' },
  postAuthor: { fontSize: 16, fontWeight: '700', color: Colors.text },
  postDate: { fontSize: 14, color: Colors.textSub },
  newsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF3E0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newsBadgeText: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.light,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryBadgeText: { fontSize: 13, fontWeight: '600', color: Colors.dark },
  postTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  postContent: {
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingBottom: 16,
    lineHeight: 26,
  },
  statsRow: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statText: { fontSize: 14, color: Colors.textSub },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeCount: { fontSize: 16, fontWeight: '600', color: Colors.textSub },
  likeCountActive: { color: Colors.danger },
  divider: {
    height: 8,
    backgroundColor: Colors.background,
  },
  commentHeader: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  commentTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  commentItem: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  commentCard: {
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  commentTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  commentAuthor: { fontSize: 15, fontWeight: '700', color: Colors.text },
  commentTime: { fontSize: 13, color: Colors.textHint },
  commentContent: { fontSize: 16, color: Colors.text, lineHeight: 24, marginBottom: 8 },
  commentActions: { flexDirection: 'row', gap: 16 },
  actionBtn: { paddingVertical: 2 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { fontSize: 14, color: Colors.textSub },
  replyCard: {
    flexDirection: 'row',
    paddingTop: 12,
    paddingLeft: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  replyArrow: { fontSize: 18, color: Colors.textHint, marginRight: 10, marginTop: 2 },
  replyContent: { flex: 1 },
  commentInputArea: {
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.light,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  replyingText: { fontSize: 14, color: Colors.dark },
  replyCancelText: { fontSize: 14, color: Colors.textSub },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  commentInput: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.background,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 80,
  },
  commentSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 52,
    alignItems: 'center',
  },
  commentSubmitDisabled: { backgroundColor: Colors.border },
  commentSubmitText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});
