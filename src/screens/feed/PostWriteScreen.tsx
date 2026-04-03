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
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Database } from '../../types/database';

type PostType = Database['public']['Tables']['posts']['Row']['post_type'];

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORIES: { id: string; icon: IoniconName; label: string }[] = [
  { id: 'chat', icon: 'chatbubble-outline', label: '자유수다' },
  { id: 'question', icon: 'help-circle-outline', label: '질문있어요' },
  { id: 'info', icon: 'megaphone-outline', label: '정보공유' },
  { id: 'exercise', icon: 'fitness-outline', label: '운동인증' },
  { id: 'cheer', icon: 'heart-circle-outline', label: '응원해요' },
];

export function PostWriteScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const [selectedCategory, setSelectedCategory] = useState<string>('chat');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handlePhotoAdd = async () => {
    if (photos.length >= 5) {
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
      selectionLimit: 5 - photos.length,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 5));
    }
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

      if (photos.length > 0 && post) {
        for (const [idx, uri] of photos.entries()) {
          try {
            // Supabase Storage에 업로드 (R2 인프라 설정 전 대체)
            const fileName = `${user.id}/${post.id}/${idx}_${Date.now()}.jpg`;
            const response = await fetch(uri);
            const blob = await response.blob();

            const { error: storageError } = await supabase.storage
              .from('post-images')
              .upload(fileName, blob, {
                contentType: 'image/jpeg',
                upsert: false,
              });

            if (storageError) {
              console.error('스토리지 업로드 실패:', storageError);
              continue;
            }

            const { data: publicUrlData } = supabase.storage
              .from('post-images')
              .getPublicUrl(fileName);

            const publicUrl = publicUrlData?.publicUrl ?? '';

            await supabase.from('post_media').insert({
              post_id: post.id,
              r2_url: publicUrl,
              r2_key: fileName,
              media_type: 'image' as const,
              sort_order: idx,
            });
          } catch (photoErr) {
            console.error('사진 업로드 실패:', photoErr);
          }
        }
      }

      Alert.alert('등록 완료', '글이 등록되었어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '등록 중 문제가 생겼어요. 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="글쓰기"
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

          {/* 사진 추가 */}
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={handlePhotoAdd}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={22} color={Colors.textSub} />
            <Text style={styles.photoText}>사진 추가</Text>
            <Text style={styles.photoHint}>{photos.length}/5</Text>
          </TouchableOpacity>

          {/* 선택된 사진 미리보기 */}
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
              {photos.map((uri, idx) => (
                <View key={idx} style={styles.photoThumb}>
                  <Image source={{ uri }} style={styles.photoThumbImg} />
                  <TouchableOpacity
                    style={styles.photoRemoveBtn}
                    onPress={() => setPhotos(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <Ionicons name="close-circle" size={22} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </ScrollView>

        <View style={styles.bottomActions}>
          <TouchableOpacity style={styles.bottomMainBtn} onPress={handleSubmit} activeOpacity={0.85} disabled={submitting}>
            <Text style={styles.bottomMainBtnText}>{submitting ? '등록 중...' : '등록하기'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 16,
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
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  categoryBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  categoryLabel: { fontSize: 13, fontWeight: '700', color: Colors.textSub, textAlign: 'center' },
  categoryLabelSelected: { color: Colors.dark },
  titleInput: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 52,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  contentInput: {
    fontSize: 16,
    color: Colors.text,
    paddingVertical: 14,
    paddingHorizontal: 0,
    minHeight: 200,
    lineHeight: 26,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  photoText: { fontSize: 16, fontWeight: '600', color: Colors.textSub, flex: 1 },
  photoHint: { fontSize: 13, color: Colors.textHint },
  photoRow: { marginTop: 8, marginBottom: 4 },
  photoThumb: { position: 'relative', marginRight: 8 },
  photoThumbImg: { width: 80, height: 80, borderRadius: 8 },
  photoRemoveBtn: { position: 'absolute', top: -8, right: -8 },
  bottomActions: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 16,
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
