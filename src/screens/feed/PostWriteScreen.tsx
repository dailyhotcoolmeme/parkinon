import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Dimensions,
  Keyboard,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadCommunityPhoto } from '../../lib/r2Upload';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Database } from '../../types/database';
import type { FeedStackParamList } from '../../navigation/FeedNavigator';
import { useDialog } from '../../context/DialogContext';
import { ensureNotGuest } from '../../utils/guestGuard';
import { ensureNotBanned, isBanRlsError, showBannedDialog } from '../../utils/banGuard';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';

type PostType = Database['public']['Tables']['posts']['Row']['post_type'];

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type RouteProps = NativeStackScreenProps<FeedStackParamList, 'PostWrite'>['route'];

function getCategories(): { id: string; icon: IoniconName; label: string }[] {
  return [
    { id: 'chat', icon: 'chatbubble-outline', label: i18n.t('postWrite.categoryChat') },
    { id: 'question', icon: 'help-circle-outline', label: i18n.t('postWrite.categoryQuestion') },
    { id: 'info', icon: 'megaphone-outline', label: i18n.t('postWrite.categoryInfo') },
    { id: 'cheer', icon: 'heart-circle-outline', label: i18n.t('postWrite.categoryCheer') },
  ];
}

// 기존 사진(r2_url)과 새 사진(local uri)을 구분
interface PhotoEntry {
  uri: string;       // local URI (새 사진) 또는 r2_url (기존 사진)
  isExisting: boolean;
}

export function PostWriteScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute<RouteProps>();
  const { user, signOut } = useAuth();
  const dialog = useDialog();
  // 완료 버튼 아래 하단 여백. 탭바 높이만큼 주면 버튼과 탭바 사이에 큰 빈 공간이 생긴다.
  // 안드 3버튼 내비/홈 인디케이터 잘림만 막는 표준 훅 값 사용(글로벌 규칙).
  const bottomPad = useBottomSheetPadding();

  // ── 본문 키보드 가림 방지 (PostDetailScreen 댓글 입력 패턴과 동일) ──
  // 안드 edge-to-edge(Expo SDK54+)에서는 키보드가 창을 리사이즈하지 않고 inset으로 들어와
  // KeyboardAvoidingView(behavior=undefined)만으로는 본문 커서가 키보드 아래로 가려진다.
  // → 키보드 높이를 직접 받아 ScrollView 맨 아래에 스페이서를 주고, 본문 입력칸의 커서 줄이
  //   항상 키보드 위에 보이도록 scrollTo로 끌어올린다. (iOS는 automaticallyAdjustKeyboardInsets가 처리)
  const scrollViewRef = useRef<ScrollView>(null);
  const contentInputRef = useRef<TextInput>(null);
  const [kbHeight, setKbHeight] = useState(0);
  const kbHeightRef = useRef(0);
  const contentFocused = useRef(false);
  // 현재 ScrollView 스크롤 오프셋(onScroll로 추적) — 화면 절대좌표 측정값을 오프셋 델타로 환산하기 위함.
  const scrollY = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      const h = e.endCoordinates?.height ?? 0;
      setKbHeight(h);
      kbHeightRef.current = h;
      if (contentFocused.current) setTimeout(scrollCursorIntoView, 60);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKbHeight(0);
      kbHeightRef.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 본문 커서 줄(=입력칸 하단 근사)을 키보드 바로 위로 끌어올린다.
  // 좌표 혼선을 막기 위해 입력칸을 화면 절대좌표(measureInWindow)로 측정하고,
  // 키보드 윗선보다 아래로 내려간 만큼(overflow)을 현재 스크롤 오프셋에 더해 스크롤한다.
  // (본문 뒤에 사진·버튼이 이어지므로 scrollToEnd 부적합 → 커서 줄 기준 정밀 스크롤)
  const scrollCursorIntoView = () => {
    if (Platform.OS !== 'android' || kbHeightRef.current === 0) return;
    const node = contentInputRef.current as any;
    if (!node?.measureInWindow) return;
    node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const keyboardTop = Dimensions.get('window').height - kbHeightRef.current;
      const cursorScreenY = y + h; // 입력칸 하단(= 마지막 줄/커서 근사)의 화면 절대 Y
      const overflow = cursorScreenY - keyboardTop + 24; // 24 = 키보드 윗선과의 여유
      if (overflow > 0) {
        scrollViewRef.current?.scrollTo({ y: scrollY.current + overflow, animated: true });
      }
    });
  };

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
      dialog.alert({ title: t('postWrite.photoLimitTitle'), message: t('postWrite.photoLimitMsg') });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('postWrite.permTitle'), message: t('postWrite.permMsg') });
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
    if (await ensureNotGuest(user, dialog, { signOut })) return;
    if (ensureNotBanned(user, dialog)) return;
    if (!selectedCategory) {
      dialog.alert({ title: t('postWrite.categoryTitle'), message: t('postWrite.categoryMsg') });
      return;
    }
    if (!title.trim()) {
      dialog.alert({ title: t('postWrite.titleRequiredTitle'), message: t('postWrite.titleRequiredMsg') });
      return;
    }
    if (!content.trim()) {
      dialog.alert({ title: t('postWrite.contentRequiredTitle'), message: t('postWrite.contentRequiredMsg') });
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

        // 새로 추가된 사진 업로드 — 병렬 처리(순차 for await 제거)로 체감 단축.
        // sort_order 는 배열 인덱스로 부여해 순서 보존(Promise.all 은 결과 순서 무관, 인덱스 고정).
        const newPhotos = photoEntries.filter(e => !e.isExisting);
        if (newPhotos.length > 0) {
          // 기존 사진 중 남아 있는 것들의 최대 sort_order 확인
          const existingCount = photoEntries.filter(e => e.isExisting).length;
          try {
            await Promise.all(
              newPhotos.map(async (entry, idx) => {
                const result = await uploadCommunityPhoto(entry.uri, user.id);
                await supabase.from('post_media').insert({
                  post_id: postId,
                  r2_url: result.url,
                  r2_key: result.key,
                  media_type: 'image' as const,
                  sort_order: existingCount + idx,
                });
              })
            );
          } catch (photoErr: any) {
            await dialog.alert({ title: t('postWrite.photoUploadErrorTitle'), message: photoErr?.message ?? String(photoErr) });
            setSubmitting(false);
            return; // 업로드 실패시 중단
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

        await dialog.alert({ title: t('postWrite.editDoneTitle'), message: t('postWrite.editDoneMsg'), toast: true });
        navigation.goBack();
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
          // 병렬 업로드(순차 for await 제거). sort_order 는 인덱스로 부여해 순서 보존.
          try {
            await Promise.all(
              newPhotos.map(async (entry, idx) => {
                const result = await uploadCommunityPhoto(entry.uri, user.id);
                await supabase.from('post_media').insert({
                  post_id: post.id,
                  r2_url: result.url,
                  r2_key: result.key,
                  media_type: 'image' as const,
                  sort_order: idx,
                });
              })
            );
          } catch (photoErr: any) {
            await dialog.alert({ title: t('postWrite.photoUploadErrorTitle'), message: photoErr?.message ?? String(photoErr) });
            setSubmitting(false);
            return; // 업로드 실패시 중단
          }
        }

        await dialog.alert({ title: t('postWrite.createDoneTitle'), message: t('postWrite.createDoneMsg'), toast: true });
        navigation.goBack();
      }
    } catch (e: any) {
      // 밴된 계정의 INSERT 거부(RLS 42501) → 일반 오류 대신 이용 제한 안내
      if (isBanRlsError(e)) {
        showBannedDialog(dialog);
      } else {
        await dialog.alert({ title: t('postWrite.errorTitle'), message: e.message ?? (isEditMode ? t('postWrite.editFailMsg') : t('postWrite.createFailMsg')) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={isEditMode ? t('postWrite.titleEdit') : t('postWrite.titleWrite')}
        showBack
      />
      <KeyboardAvoidingView
        style={styles.flex}
        // Android는 매니페스트 windowSoftInputMode="adjustResize"가 창을 줄여주므로
        // behavior 지정 시 이중 처리로 레이아웃이 어긋난다 → undefined (정상 레퍼런스 동일).
        // iOS는 padding으로 키보드만큼 하단 여백 확보.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.select({ ios: 60, android: 0 })}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          // iOS는 키보드 높이만큼 자동으로 하단 인셋을 잡아 커서가 가려지지 않게 함 (RN 0.70+)
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {/* 글 유형 선택 */}
          <Text style={styles.sectionLabel}>{t('postWrite.sectionLabel')}</Text>
          <View style={styles.categoryRow}>
            {getCategories().map((cat) => (
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
                  size={20}
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
            placeholder={t('postWrite.titlePlaceholder')}
            placeholderTextColor={Colors.textHint}
            value={title}
            onChangeText={setTitle}
            maxLength={50}
            returnKeyType="next"
          />

          <View style={styles.divider} />

          {/* 내용 */}
          <TextInput
            ref={contentInputRef}
            style={styles.contentInput}
            placeholder={t('postWrite.contentPlaceholder')}
            placeholderTextColor={Colors.textHint}
            value={content}
            onChangeText={setContent}
            multiline
            textAlignVertical="top"
            maxLength={2000}
            // 입력칸이 길어지며 커서 줄이 키보드 아래로 내려가면 그만큼 스크롤해 항상 키보드 위에 보이게.
            // onContentSizeChange: 줄 추가/줄바꿈, onSelectionChange: 커서 이동(중간 편집)
            onContentSizeChange={() => {
              if (contentFocused.current) scrollCursorIntoView();
            }}
            onSelectionChange={() => {
              if (contentFocused.current) scrollCursorIntoView();
            }}
            onFocus={() => {
              contentFocused.current = true;
              setTimeout(scrollCursorIntoView, 250);
            }}
            onBlur={() => {
              contentFocused.current = false;
            }}
          />

          {/* 사진 + 등록 버튼 — 스크롤 내부 */}
          <View style={[styles.bottomActions, { paddingBottom: bottomPad }]}>
          <View style={styles.divider} />

          {/* 사진 추가 */}
          {photoEntries.length === 0 ? (
            <TouchableOpacity
              style={styles.photoBtnLarge}
              onPress={handlePhotoAdd}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={28} color="#AAAAAA" />
              <Text style={styles.photoBtnLargeText}>{t('postWrite.photoAddLarge')}</Text>
              <Text style={styles.photoBtnLargeHint}>{t('postWrite.photoAddHint')}</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={styles.photoBtn}
                onPress={handlePhotoAdd}
                activeOpacity={0.7}
              >
                <Ionicons name="camera-outline" size={22} color={Colors.textSub} />
                <Text style={styles.photoText}>{t('postWrite.photoAdd')}</Text>
                <Text style={styles.photoHint}>{photoEntries.length}/5</Text>
              </TouchableOpacity>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photoRow}
                contentContainerStyle={{ paddingTop: 4, paddingBottom: 4 }}
              >
                {photoEntries.map((entry, idx) => (
                  <View key={idx} style={styles.photoThumbWrap}>
                    <View style={styles.photoThumb}>
                      <Image source={{ uri: entry.uri }} style={styles.photoThumbImg} />
                      {entry.isExisting && (
                        <View style={styles.existingBadge}>
                          <Text style={styles.existingBadgeText}>{t('postWrite.photoExisting')}</Text>
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
            </>
          )}

          {/* 커뮤니티 운영정책 한 줄 고지 (App Store UGC 가이드라인 1.2)
              "이용약관" 부분을 누르면 약관 화면(커뮤니티 운영정책=약관 제10조 포함)이 열린다.
              Terms 화면은 다른 네비게이터(Menu)에 있어 이 스택에서 navigate 불가 → 외부 링크로 연다.
              (이 화면 형제인 LoginScreen도 동일하게 Linking으로 약관을 연다.) */}
          <Text style={styles.guidelineNotice}>
            {t('postWrite.guidelineNotice')}
            <Text
              style={styles.guidelineLink}
              suppressHighlighting
              onPress={() => {
                Linking.openURL('https://parkinon.com/terms').catch(() => {
                  dialog.alert({ title: t('postWrite.noticeTitle'), message: t('postWrite.guidelineOpenFailMsg') });
                });
              }}
            >
              {t('postWrite.guidelineLink')}
            </Text>
            {t('postWrite.guidelineSuffix')}
          </Text>

          <TouchableOpacity style={styles.bottomMainBtn} onPress={handleSubmit} activeOpacity={0.85} disabled={submitting}>
            <Text style={styles.bottomMainBtnText}>
              {isEditMode ? t('postWrite.submitEdit') : t('postWrite.submitCreate')}
            </Text>
          </TouchableOpacity>
          </View>

          {/* 안드 edge-to-edge 키보드 가림 방지용 하단 스페이서 — 키보드 높이만큼 공간을 줘
              본문 커서 줄이 키보드 위로 스크롤될 수 있게 한다. (PostDetailScreen 패턴과 동일) */}
          {kbHeight > 0 && <View style={{ height: kbHeight }} />}
        </ScrollView>
      </KeyboardAvoidingView>
      <BrandProgressOverlay
        visible={submitting}
        title={isEditMode ? t('postWrite.submittingEdit') : t('postWrite.submittingCreate')}
        minVisibleMs={500}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 0 },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  categoryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
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
    paddingVertical: 10,
    paddingHorizontal: 0,
    minHeight: 48,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  contentInput: {
    // flex/scrollEnabled 금지 — 멀티라인 입력은 내용에 따라 높이가 자라야
    // 바깥 ScrollView가 스크롤되어 커서 줄이 키보드 위에 유지된다.
    // (MedicalRecordWriteScreen 패턴과 동일: minHeight만 주고 자연 성장)
    minHeight: 180,
    fontSize: 18,
    color: Colors.text,
    paddingVertical: 10,
    paddingHorizontal: 0,
    lineHeight: 27,
  },
  photoBtnLarge: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 6,
    marginBottom: 6,
    minHeight: 60,
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
    paddingVertical: 10,
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
    paddingTop: 4,
  },
  guidelineNotice: {
    fontSize: 13,
    color: Colors.textHint,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  // 약관 링크: 보조 고지문 안에 있어 작게 보이되, 밑줄+강조색으로 누를 수 있음을 분명히.
  // 글자가 작아 터치가 빗나가지 않도록 lineHeight를 본문보다 키워 세로 터치영역을 넉넉히.
  guidelineLink: {
    color: Colors.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    lineHeight: 26,
  },
  bottomMainBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomMainBtnText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
});
