import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';

type RouteProps = NativeStackScreenProps<FeedStackParamList, 'PostDetail'>['route'];

interface Comment {
  id: string;
  author: string;
  timeAgo: string;
  content: string;
  likeCount: number;
  replies: Reply[];
}

interface Reply {
  id: string;
  author: string;
  timeAgo: string;
  content: string;
  likeCount: number;
}

const DUMMY_COMMENTS: Comment[] = [
  {
    id: 'c1',
    author: '이영호',
    timeAgo: '1시간 전',
    content: '저도 같은 고민이 있었어요. 알람 앱을 사용하니 많이 도움이 됐어요.',
    likeCount: 2,
    replies: [
      {
        id: 'r1',
        author: '홍길동',
        timeAgo: '30분 전',
        content: '어떤 앱 사용하시나요? 저도 알려주세요.',
        likeCount: 0,
      },
    ],
  },
  {
    id: 'c2',
    author: '박수연',
    timeAgo: '2시간 전',
    content: '가족분들과 함께 관리하면 훨씬 수월해요. 파킨온 앱이 도움이 될 것 같아요!',
    likeCount: 5,
    replies: [],
  },
  {
    id: 'c3',
    author: '김철수',
    timeAgo: '어제',
    content: '힘내세요 😊 저도 처음엔 어려웠지만 익숙해지더라고요.',
    likeCount: 3,
    replies: [],
  },
];

export function PostDetailScreen() {
  const route = useRoute<RouteProps>();
  const { post } = route.params;
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<Comment[]>(DUMMY_COMMENTS);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const handleLike = () => {
    setLiked(!liked);
    setLikeCount((prev) => (liked ? prev - 1 : prev + 1));
  };

  const handleCommentSubmit = () => {
    if (!commentText.trim()) return;

    if (replyingTo) {
      const newReply: Reply = {
        id: `r${Date.now()}`,
        author: '나',
        timeAgo: '방금 전',
        content: commentText.trim(),
        likeCount: 0,
      };
      setComments((prev) =>
        prev.map((c) =>
          c.id === replyingTo ? { ...c, replies: [...c.replies, newReply] } : c
        )
      );
      setReplyingTo(null);
    } else {
      const newComment: Comment = {
        id: `c${Date.now()}`,
        author: '나',
        timeAgo: '방금 전',
        content: commentText.trim(),
        likeCount: 0,
        replies: [],
      };
      setComments((prev) => [...prev, newComment]);
    }
    setCommentText('');
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

          {/* 사진 영역 (더미) */}
          {post.thumbnail && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
              <View style={styles.photoItem}>
                <Text style={styles.photoEmoji}>{post.thumbnail}</Text>
              </View>
            </ScrollView>
          )}

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

          {comments.map((comment) => (
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
                    onPress={() => Alert.alert('좋아요', '좋아요를 눌렀어요.')}
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
                      <TouchableOpacity style={styles.actionBtn}>
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
          ))}
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
              style={[styles.commentSubmitBtn, !commentText.trim() && styles.commentSubmitDisabled]}
              onPress={handleCommentSubmit}
              disabled={!commentText.trim()}
            >
              <Text style={styles.commentSubmitText}>등록</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
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
  photoScroll: {
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  photoItem: {
    width: 120,
    height: 120,
    backgroundColor: Colors.background,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  photoEmoji: { fontSize: 50 },
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
