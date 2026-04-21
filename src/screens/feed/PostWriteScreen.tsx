import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadPhoto } from '../../lib/r2Upload';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Database } from '../../types/database';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';

type PostType = Database['public']['Tables']['posts']['Row']['post_type'];

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type RouteProps = NativeStackScreenProps<FeedStackParamList, 'PostWrite'>['route'];

const CATEGORIES: { id: string; icon: IoniconName; label: string }[] = [
  { id: 'chat', icon: 'chatbubble-outline', label: '자유' },
  { id: 'question', icon: 'help-circle-outline', label: '질문' },
  { id: 'info', icon: 'megaphone-outline', label: '정보' },
  { id: 'exercise', icon: 'fitness-outline', label: '운동인증' },
  { id: 'cheer', icon: 'heart-circle-outline', label: '응원' },
];

// 기존 사진(r2_url)과 새 사진(local uri)을 구분
interface PhotoEntry {
  uri: string;       // local URI (새 사진) 또는 r2_url (기존 사진)
  isExisting: boolean;
}

export function PostWriteScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const { user } = useAuth();

  const params = route.params;
  const isEditMode = !!(params?.postId);
  const postId = params?.postId;

  const [selectedCategory, setSelectedCategory] = useState<string>(
    params?.initialCategory ?? 'chat'
  );
  const [title, setTitle] = useState(params?.initialTitle ?? '');
  const [content, setContent] = useState(params?.initialContent ?? '');
  // 기존 사진은 isExisting=true, 새로 추가한 사진은 isExisting=false
  const [photoEntries, setPhotoEntries] = useState<PhotoEntry[]>(
    (params?.initialPhotos ?? []).map((url) => ({ uri: url, isExisting: true }))
  );
  const [submitting, setSubmitting] = useState(false);

  // 삭제 대상 기존 사진 r2_url 목록
  const [deletedExistingUrls, setDeletedExistingUrls] = useState<string[]>([]);

  const handlePhotoAdd = async () => {
    if (photoEntries.length >= 5) {
      Alert.alert('사진 제한', '사진은 최대 5장까지 추가할 수 있어요.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 5 - photoEntries.length,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const compressed: PhotoEntry[] = await Promise.all(
        result.assets.map(async (a) => {
          try {
            const manipResult = await ImageManipulator.manipulateAsync(
              a.uri,
              [{ resize: { width: 1280 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            return { uri: manipResult.uri, isExisting: false };
          } catch {
            return { uri: a.uri, isExisting: false };
          }
        })
      );
      setPhotoEntries(prev => [...prev, ...compressed].slice(0, 5));
    }
  };

  const handleRemovePhoto = (idx: number) => {
    const entry = photoEntries[idx];
    if (entry.isExisting) {
      setDeletedExistingUrls(prev => [...prev, entry.uri]);
    }
    setPhotoEntries(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!selectedCategory) {
      Alert.alert('글 유형 선택', '글 유형을 선택해주세요.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('제목 입력', '제목을 입력해주세요.');
      return;
    }
    if (!content.trim()) {
      Alert.alert('내용 입력', '내용을 입력해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode && postId) {
        // ── 수정 모드 ──
        const { error: updateError } = await supabase
          .from('posts')
          .update({
            post_type: selectedCategory as PostType,
            title: title.trim(),
            content: content.trim(),
          })
          .eq('id', postId);
        if (updateError) throw updateError;

        // 삭제된 기존 사진 제거
        if (deletedExistingUrls.length > 0) {
          await supabase
            .from('post_media')
            .delete()
            .eq('post_id', postId)
            .in('r2_url', deletedExistingUrls);
        }

        // 새로 추가된 사진 업로드
        const newPhotos = photoEntries.filter(e => !e.isExisting);
        if (newPhotos.length > 0) {
          // 기존 사진 중 남아 있는 것들의 최대 sort_order 확인
          const existingCount = photoEntries.filter(e => e.isExisting).length;
          let uploadFailCount = 0;
          for (const [idx, entry] of newPhotos.entries()) {
            try {
              const result = await uploadPhoto(entry.uri, user.id);
              await supabase.from('post_media').insert({
                post_id: postId,
                r2_url: result.url,
                r2_key: result.key,
                media_type: 'image' as const,
                sort_order: existingCount + idx,
              });
            } catch (photoErr: any) {
              Alert.alert('사진 업로드 에러', photoErr?.message ?? String(photoErr));
              setSubmitting(false);
              return; // 업로드 실패시 중단
            }
          }
          if (uploadFailCount > 0) {
            Alert.alert(
              '사진 업로드 일부 실패',
              `${uploadFailCount}장의 사진이 업로드되지 않았어요. 수정 내용은 저장되었습니다.`,
              [{ text: '확인', onPress: () => navigation.goBack() }]
            );
            return;
          }
        }

        // 수정 후 최신 사진 목록 조회하여 콜백 전달
        const { data: updatedMedia } = await supabase
          .from('post_media')
          .select('r2_url, sort_order')
          .eq('post_id', postId)
          .eq('media_type', 'image')
          .order('sort_order', { ascending: true });
        const updatedUrls = (updatedMedia ?? []).map((m: any) => m.r2_url);
        params?.onSave?.(updatedUrls);

        Alert.alert('수정 완료', '글이 수정되었어요.', [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      } else {
        // ── 등록 모드 ──
        const { data: post, error: postError } = await supabase
          .from('posts')
          .insert({
            author_id: user.id,
            post_type: selectedCategory as PostType,
            title: title.trim(),
            content: content.trim(),
            is_news: false,
            news_url: null,
            youtube_url: null,
            youtube_thumbnail: null,
          })
          .select()
          .single();

        if (postError) throw postError;

        const newPhotos = photoEntries.filter(e => !e.isExisting);
        if (newPhotos.length > 0 && post) {
          let uploadFailCount = 0;
          for (const [idx, entry] of newPhotos.entries()) {
            try {
              const result = await uploadPhoto(entry.uri, user.id);
              await supabase.from('post_media').insert({
                post_id: post.id,
                r2_url: result.url,
                r2_key: result.key,
                media_type: 'image' as const,
                sort_order: idx,
              });
            } catch (photoErr: any) {
              Alert.alert('사진 업로드 에러', photoErr?.message ?? String(photoErr));
              setSubmitting(false);
              return; // 업로드 실패시 중단
            }
          }
          if (uploadFailCount > 0) {
            Alert.alert(
              '사진 업로드 일부 실패',
              `${uploadFailCount}장의 사진이 업로드되지 않았어요. 글은 정상 등록되었습니다.`,
              [{ text: '확인', onPress: () => navigation.goBack() }]
            );
            return;
          }
        }

        Alert.alert('등록 완료', '글이 등록되었어요.', [
          { text: '확인', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('오류', e.message ?? (isEditMode ? '수정 중 문제가 생겼어요. 다시 시도해주세요.' : '등록 중 문제가 생겼어요. 다시 시도해주세요.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={isEditMode ? '글 수정' : '글쓰기'}
        showBack
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={60}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* 글 유형 선택 */}
          <Text style={styles.sectionLabel}>글 유형 선택</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryBtn,
                  selectedCategory === cat.id && styles.categoryBtnSelected,
                ]}
                onPress={() => setSelectedCategory(cat.id)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={cat.icon}
                  size={28}
                  color={selectedCategory === cat.id ? Colors.primary : Colors.textSub}
                />
                <Text
                  style={[
                    styles.categoryLabel,
                    selectedCategory === cat.id && styles.categoryLabelSelected,
                  ]}
                  numberOfLines={1}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 제목 */}
          <TextInput
            style={styles.titleInput}
            placeholder="제목을 입력해주세요"
            placeholderTextColor={Colors.textHint}
            value={title}
            onChangeText={setTitle}
            maxLength={50}
            returnKeyType="next"
          />

          <View style={styles.divider} />

          {/* 내용 */}
          <TextInput
            style={styles.contentInput}
            placeholder="내용을 입력해주세요"
            placeholderTextColor={Colors.textHint}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            maxLength={2000}
          />

          <View style={styles.divider} />

          {/* 사진 추가 - 사진 없을 때는 큰 박스, 있을 때는 상단 작은 버튼 */}
          {photoEntries.length === 0 ? (
            <TouchableOpacity
              style={styles.photoBtnLarge}
              onPress={handlePhotoAdd}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={28} color="#AAAAAA" />
              <Text style={styles.photoBtnLargeText}>사진 추가하기</Text>
              <Text style={styles.photoBtnLargeHint}>최대 5장 · JPG/PNG</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={handlePhotoAdd}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={22} color={Colors.textSub} />
              <Text style={styles.photoText}>사진 추가</Text>
              <Text style={styles.photoHint}>{photoEntries.length}/5</Text>
            </TouchableOpacity>
          )}

          {/* 선택된 사진 미리보기 */}
          {photoEntries.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photoRow}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 4 }}
            >
              {photoEntries.map((entry, idx) => (
                <View key={idx} style={styles.photoThumbWrap}>
                  <View style={styles.photoThumb}>
                    <Image source={{ uri: entry.uri }} style={styles.photoThumbImg} />
                    {entry.isExisting && (
                      <View style={styles.existingBadge}>
                        <Text style={styles.existingBadgeText}>기존</Text>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => handleRemovePhoto(idx)}
                    hitSlop={{ top: 4, right: 4, bottom: 4, left: 4 }}
                  >
                    <Ionicons name="close-circle" size={26} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </ScrollView>

        <View style={styles.bottomActions}>
          <TouchableOpacity style={styles.bottomMainBtn} onPress={handleSubmit} activeOpacity={0.85} disabled={submitting}>
            <Text style={styles.bottomMainBtnText}>
              {submitting
                ? (isEditMode ? '수정 중...' : '등록 중...')
                : (isEditMode ? '수정하기' : '등록하기')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 16 },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 12,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 20,
  },
  categoryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 72,
  },
  categoryBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  categoryLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSub, textAlign: 'center' },
  categoryLabelSelected: { color: Colors.dark },
  titleInput: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 56,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  contentInput: {
    fontSize: 18,
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 200,
    lineHeight: 28,
  },
  photoBtnLarge: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    borderStyle: 'dashed',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 8,
    minHeight: 68,
  },
  photoBtnLargeText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#888888',
  },
  photoBtnLargeHint: {
    fontSize: 15,
    color: Colors.textHint,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  photoText: { fontSize: 18, fontWeight: '600', color: Colors.textSub, flex: 1 },
  photoHint: { fontSize: 13, color: Colors.textHint },
  photoRow: { marginTop: 0, marginBottom: 4 },
  photoThumbWrap: { position: 'relative', marginRight: 16, paddingTop: 10, paddingRight: 10 },
  photoThumb: {},
  photoThumbImg: { width: 88, height: 88, borderRadius: 8 },
  photoRemoveBtn: { position: 'absolute', top: 0, right: 0 },
  existingBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  existingBadgeText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  bottomActions: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  bottomMainBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomMainBtnText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
});
