import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video as AVVideo, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Video as VideoCompressor } from 'react-native-compressor';
import { TopBar } from '../../components/common/TopBar';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { ImageGalleryViewer } from '../../components/common/ImageGalleryViewer';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { useDiary, DiaryEntry, AutoSummary } from '../../hooks/useDiary';
import { uploadPhoto, uploadVideo, uploadSound } from '../../lib/r2Upload';

// ─── 일기장 로컬 팔레트 §11-1 (DiaryScreen 전용, 전역 Colors 미변경 / 녹색 0%) ──────
const Journal = {
  page: '#F4EEDF', // 화면 전체(부드러운 크림 종이) — 한 장의 페이지
  pageDeep: '#EFE7D3', // 작성 모달 배경
  surface: '#FAF5E9', // 첨부 프레임/음성칩 등 살짝 밝은 면 (카드 아님)
  rule: '#E0D4BC', // 괘선·구분선·날짜 밑줄 (은은)
  ink: '#3A3128', // 본문 잉크(따뜻한 진갈색)
  inkSoft: '#7A6E5C', // 저자명·보조
  inkFaint: '#A99B82', // 하단 각주(건강데이터)·플레이스홀더보다 진함
  placeholder: '#BBAd92', // 에디터 플레이스홀더
  accent: '#B5613E', // 세피아 테라코타 — 아주 가끔(추세보기·저장·녹음중)
  accentSoft: '#ECDDCB', // 악센트 옅은 배경
  mine: '#B89A52', // 내 글 표시(작은 점/마크)
} as const;

const SERIF = Platform.select({ ios: 'Georgia', android: 'serif' });

const WEEKDAYS_FULL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const MAX_VIDEO_DURATION_SEC = 120;
const UPLOAD_TIMEOUT_MS = 180_000;

// KST(UTC+9) 기준 YYYY-MM-DD 문자열 반환
function toKstDateString(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// YYYY-MM-DD(KST) → 정오 기준 Date (DatePicker/표시용, 날짜 경계 안전)
function dateStrToDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function shiftDate(dateStr: string, days: number): string {
  const dt = dateStrToDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return toKstDateString(new Date(dt.getTime() - 9 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
}

export function DiaryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const dialog = useDialog();

  const todayStr = toKstDateString(new Date());
  const initialDate: string = route.params?.date ?? todayStr;
  const [dateStr, setDateStr] = useState<string>(initialDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const { autoSummary, entries, loading, patientId, saveMyEntry, deleteMyEntry } = useDiary(dateStr);

  // 미래 날짜로는 이동 금지
  const isToday = dateStr === todayStr;
  const canGoNext = dateStr < todayStr;

  const myEntry = entries.find((e) => e.author_id === user?.id) ?? null;

  const dt = dateStrToDate(dateStr);
  const dateTitle = `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${WEEKDAYS_FULL[dt.getDay()]}`;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="일기" showBack />

      {/* ── 날짜 헤더 (우아한 serif, 한 장의 페이지) §11-3 ── */}
      <View style={styles.dateHeader}>
        <View style={styles.dateHeaderRow}>
          <TouchableOpacity
            style={styles.navArrowBtn}
            onPress={() => setDateStr(shiftDate(dateStr, -1))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color={Journal.inkSoft} />
          </TouchableOpacity>

          <View style={styles.dateCenter}>
            <View style={styles.dateTopRow}>
              <Text style={styles.dateTitle}>{dateTitle}</Text>
              {isToday && (
                <View style={styles.todayChip}>
                  <Text style={styles.todayChipText}>오늘</Text>
                </View>
              )}
            </View>
            <View style={styles.dateRule} />
          </View>

          <View style={styles.dateRightCol}>
            <TouchableOpacity
              style={[styles.navArrowBtn, !canGoNext && styles.navArrowDisabled]}
              onPress={() => canGoNext && setDateStr(shiftDate(dateStr, 1))}
              disabled={!canGoNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-forward" size={26} color={canGoNext ? Journal.inkSoft : Journal.rule} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.calBtn}
              onPress={() => setShowDatePicker(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="calendar-outline" size={20} color={Journal.inkSoft} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Journal.accent} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 한마디 (본문, 주연) — 한 장의 페이지, 블록 사이 rule 1px §11-3 ── */}
          {entries.length === 0 && (
            <Text style={styles.emptyEntryText}>아직 작성한 글이 없어요.</Text>
          )}

          {entries.map((entry, idx) => (
            <View key={entry.id}>
              {idx > 0 && <View style={styles.entryRule} />}
              <EntryBlock entry={entry} isMine={entry.author_id === user?.id} />
            </View>
          ))}

          {/* 내가 안 썼으면 쓰기 진입 / 썼으면 수정 — 조용한 한 줄 */}
          <TouchableOpacity style={styles.writeEntryLink} onPress={() => setShowEditor(true)} activeOpacity={0.7}>
            <Text style={styles.writeEntryText}>
              {myEntry ? '✏️ 수정' : '✏️ 글 쓰기'}
            </Text>
          </TouchableOpacity>

          {/* ── 건강 데이터 = 페이지 하단 각주 블록 §11-3 ── */}
          <AutoFootnote summary={autoSummary} dialog={dialog} />

          <View style={{ height: 28 }} />
        </ScrollView>
      )}

      <DatePickerModal
        visible={showDatePicker}
        selectedDate={dateStrToDate(dateStr)}
        onSelect={(d) => {
          const picked = toKstDateString(new Date(d.getTime() - 9 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
          // 미래 날짜 클램프
          setDateStr(picked > todayStr ? todayStr : picked);
        }}
        onClose={() => setShowDatePicker(false)}
      />

      {showEditor && patientId && (
        <DiaryEditorModal
          visible={showEditor}
          dateStr={dateStr}
          patientId={patientId}
          existing={myEntry}
          onClose={() => setShowEditor(false)}
          onSaved={async (input) => {
            await saveMyEntry(input);
            setShowEditor(false);
          }}
          onDeleted={async () => {
            await deleteMyEntry();
            setShowEditor(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── 건강 데이터 — 페이지 하단 각주 블록 §11-3 ─────────────────────────────────

function AutoFootnote({ summary, dialog }: { summary: AutoSummary | null; dialog: ReturnType<typeof useDialog> }) {
  if (!summary) return null;
  const hasAny = summary.med.count > 0 || summary.onOff.scores.length > 0 || summary.exercise.length > 0;

  return (
    <View style={styles.footnote}>
      {/* 위 rule + 아주 작은 라벨 / 우측 끝 추세보기 */}
      <View style={styles.footnoteRule} />
      <View style={styles.footnoteHeaderRow}>
        <Text style={styles.footnoteLabel}>오늘의 기록</Text>
        <WebTrendLink dialog={dialog} />
      </View>

      {!hasAny ? (
        <Text style={styles.footnoteText}>이 날은 자동으로 모인 기록이 없어요.</Text>
      ) : (
        <View style={styles.footnoteRows}>
          {summary.med.count > 0 && (
            <Text style={styles.footnoteText} numberOfLines={2}>
              💊 약 {summary.med.count}회
              {summary.med.times.length > 0 ? ` · ${summary.med.times.join(' ')}` : ''}
            </Text>
          )}

          {summary.onOff.scores.length > 0 && (
            <View style={styles.onOffBlock}>
              {/* 몸상태 줄 */}
              {summary.onOff.scores.some((s) => s.body != null) && (
                <View style={styles.footnoteScoreRow}>
                  <Text style={styles.onOffLineLabel}>몸상태</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.scoreScroll}
                    contentContainerStyle={styles.scoreRow}
                  >
                    {summary.onOff.scores
                      .filter((s) => s.body != null)
                      .map((s, i) => (
                        <View key={`b-${i}`} style={styles.scoreChip}>
                          <Text style={styles.scoreChipLabel}>{s.label}</Text>
                          <Text style={styles.scoreChipScore}>{s.body}</Text>
                        </View>
                      ))}
                  </ScrollView>
                </View>
              )}

              {/* 기분 줄 */}
              {summary.onOff.scores.some((s) => s.mood != null) && (
                <View style={styles.footnoteScoreRow}>
                  <Text style={styles.onOffLineLabel}>기분</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.scoreScroll}
                    contentContainerStyle={styles.scoreRow}
                  >
                    {summary.onOff.scores
                      .filter((s) => s.mood != null)
                      .map((s, i) => (
                        <View key={`m-${i}`} style={styles.scoreChip}>
                          <Text style={styles.scoreChipLabel}>{s.label}</Text>
                          <Text style={styles.scoreChipScore}>{s.mood}</Text>
                        </View>
                      ))}
                  </ScrollView>
                </View>
              )}
            </View>
          )}

          {summary.exercise.length > 0 && (
            <Text style={styles.footnoteText} numberOfLines={2}>
              🏃 {summary.exercise.map((e) => `${e.type} ${e.minutes}분`).join(', ')}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── 웹 추세 보기 — 작은 텍스트 링크 (각주 우측 끝) ─────────────────────────────

function WebTrendLink({ dialog }: { dialog: ReturnType<typeof useDialog> }) {
  const [webLoading, setWebLoading] = useState(false);
  const handleWebOpen = async () => {
    if (webLoading) return;
    setWebLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-web-token');
      if (error || !data?.url) throw new Error(error?.message || '링크 생성 실패');
      await Linking.openURL(data.url as string);
    } catch (e: any) {
      dialog.alert({ title: '오류', message: e?.message || '잠시 후 다시 시도해주세요.' });
    } finally {
      setWebLoading(false);
    }
  };
  return (
    <TouchableOpacity
      style={styles.trendLink}
      onPress={handleWebOpen}
      activeOpacity={0.7}
      disabled={webLoading}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {webLoading ? (
        <ActivityIndicator size="small" color={Journal.accent} />
      ) : (
        <>
          <Text style={styles.trendLinkText}>추세보기</Text>
          <Ionicons name="chevron-forward" size={14} color={Journal.accent} />
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── 한마디 글 블록 (본문, 주연) §11-3 ────────────────────────────────────────

function EntryBlock({ entry, isMine }: { entry: DiaryEntry; isMine: boolean }) {
  const dialog = useDialog();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const handlePlayAudio = async () => {
    if (!entry.audio_url) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setPlaying(false);
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: entry.audio_url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setPlaying(false);
          sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
        }
      });
    } catch (e) {
      setPlaying(false);
      dialog.alert({ title: '재생할 수 없어요', message: '다시 시도해 주세요.' });
    }
  };

  const roleLabel = entry.author_role === 'caregiver' ? '보호자' : '환자';
  const [showPhotos, setShowPhotos] = useState(false);

  return (
    <View style={styles.entryBlock}>
      {/* 저자명 한 줄: 내 글은 앞에 작은 mine 점(•) */}
      <View style={styles.entryHeader}>
        {isMine && <View style={styles.mineDot} />}
        <Text style={styles.entryAuthor}>{entry.author_name}</Text>
        <Text style={styles.entryRole}>{roleLabel}</Text>
      </View>

      {!!entry.text && <Text style={styles.entryText}>{entry.text}</Text>}

      {/* 음성: surface 인라인 pill */}
      {entry.audio_url && (
        <TouchableOpacity style={styles.audioPill} onPress={handlePlayAudio} activeOpacity={0.8}>
          <Ionicons name={playing ? 'stop' : 'play'} size={18} color={Journal.accent} />
          <Text style={styles.audioPillText}>{playing ? '음성 멈춤' : '음성 듣기'}</Text>
        </TouchableOpacity>
      )}

      {/* 사진·영상: 액자 프레임 가로 나열 */}
      {(entry.photo_urls.length > 0 || entry.video_url) && (
        <View style={styles.frameRow}>
          {entry.photo_urls.length > 0 && (
            <TouchableOpacity
              style={styles.photoFrame}
              activeOpacity={0.85}
              onPress={() => setShowPhotos(true)}
            >
              <Image source={{ uri: entry.photo_urls[0] }} style={styles.photoFrameImg} />
              {entry.photo_urls.length > 1 && (
                <View style={styles.photoCountBadge}>
                  <Text style={styles.photoCountText}>+{entry.photo_urls.length - 1}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {entry.video_url && (
            <TouchableOpacity style={styles.videoFrame} activeOpacity={0.85} onPress={() => setShowVideo(true)}>
              <View style={styles.videoFrameInner}>
                <View style={styles.playCircle}>
                  <Ionicons name="play" size={20} color="#fff" />
                </View>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 사진 탭 → 기존 ImageGalleryViewer 라이트박스 */}
      {entry.photo_urls.length > 0 && showPhotos && (
        <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowPhotos(false)}>
          <View style={styles.photoModalBg}>
            <SafeAreaView edges={['top']} style={styles.photoModalHeader}>
              <TouchableOpacity style={styles.photoCloseBtn} onPress={() => setShowPhotos(false)} activeOpacity={0.8}>
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.photoCloseText}>닫기</Text>
              </TouchableOpacity>
            </SafeAreaView>
            <View style={styles.photoModalBody}>
              <ImageGalleryViewer urls={entry.photo_urls} />
            </View>
          </View>
        </Modal>
      )}

      {entry.video_url && showVideo && (
        <FullscreenVideoModal url={entry.video_url} onClose={() => setShowVideo(false)} />
      )}
    </View>
  );
}

// ─── 풀스크린 영상 재생 (expo-av Video) ───────────────────────────────────────

function FullscreenVideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const videoRef = useRef<AVVideo>(null);

  const handleClose = async () => {
    try {
      await videoRef.current?.pauseAsync();
      await videoRef.current?.unloadAsync();
    } catch (_) {
      /* noop */
    }
    onClose();
  };

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <View style={styles.videoModalBg}>
        <SafeAreaView edges={['top']} style={styles.videoModalHeader}>
          <TouchableOpacity style={styles.videoCloseBtn} onPress={handleClose} activeOpacity={0.8}>
            <Ionicons name="close" size={26} color="#fff" />
            <Text style={styles.videoCloseText}>닫기</Text>
          </TouchableOpacity>
        </SafeAreaView>
        <AVVideo
          ref={videoRef}
          source={{ uri: url }}
          style={styles.fullscreenVideo}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
          shouldPlay
        />
      </View>
    </Modal>
  );
}

// ─── 작성/수정 에디터 (펼친 일기장) ───────────────────────────────────────────

interface EditorProps {
  visible: boolean;
  dateStr: string;
  patientId: string;
  existing: DiaryEntry | null;
  onClose: () => void;
  onSaved: (input: {
    text: string;
    audioUrl: string | null;
    audioR2Key: string | null;
    photoUrls: string[];
    videoMediaId: string | null;
  }) => Promise<void>;
  onDeleted: () => Promise<void>;
}

function DiaryEditorModal({ visible, dateStr, patientId, existing, onClose, onSaved, onDeleted }: EditorProps) {
  const { user } = useAuth();
  const dialog = useDialog();

  const [text, setText] = useState(existing?.text ?? '');
  // 사진: 기존 url + 신규로 추가한 로컬 uri 를 함께 관리
  const [photoUrls, setPhotoUrls] = useState<string[]>(existing?.photo_urls ?? []);
  const [newPhotoUris, setNewPhotoUris] = useState<string[]>([]);
  // 음성
  const [audioUrl, setAudioUrl] = useState<string | null>(existing?.audio_url ?? null);
  const [audioR2Key, setAudioR2Key] = useState<string | null>(existing?.audio_r2_key ?? null);
  const [recordedAudioUri, setRecordedAudioUri] = useState<string | null>(null);
  // 영상
  const [videoMediaId, setVideoMediaId] = useState<string | null>(existing?.video_media_id ?? null);
  const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(existing?.video_url ?? null);
  const [newVideoUri, setNewVideoUri] = useState<string | null>(null);

  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 에디터 안 음성 미리듣기 (로컬 녹음 uri 우선, 없으면 기존 audio_url)
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  // 첨부 영상 미리보기(풀스크린)
  const [showVideoPreview, setShowVideoPreview] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      previewSoundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // ── 첨부 음성 미리듣기 (EntryBlock의 재생 패턴 재사용) ──
  const previewUri = recordedAudioUri ?? audioUrl;
  const handlePreviewAudio = async () => {
    if (!previewUri) return;
    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.unloadAsync().catch(() => {});
        previewSoundRef.current = null;
        setPreviewPlaying(false);
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: previewUri }, { shouldPlay: true });
      previewSoundRef.current = sound;
      setPreviewPlaying(true);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setPreviewPlaying(false);
          sound.unloadAsync().catch(() => {});
          if (previewSoundRef.current === sound) previewSoundRef.current = null;
        }
      });
    } catch (e) {
      setPreviewPlaying(false);
      dialog.alert({ title: '재생할 수 없어요', message: '다시 시도해 주세요.' });
    }
  };

  // 미리듣기 중인 음성을 정리(녹음 토글/빼기 시 호출)
  const stopPreviewAudio = async () => {
    if (previewSoundRef.current) {
      await previewSoundRef.current.unloadAsync().catch(() => {});
      previewSoundRef.current = null;
    }
    setPreviewPlaying(false);
  };

  // ── 사진 추가 ──
  const handleAddPhoto = async () => {
    const total = photoUrls.length + newPhotoUris.length;
    if (total >= 5) {
      dialog.alert({ title: '사진은 최대 5장이에요', message: '사진을 더 넣으려면 기존 사진을 빼주세요.' });
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: '권한 필요', message: '갤러리 접근 권한이 필요해요.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setNewPhotoUris((prev) => [...prev, result.assets[0].uri]);
    }
  };

  const handleRemovePhoto = (index: number, isExisting: boolean) => {
    if (isExisting) {
      setPhotoUrls((prev) => prev.filter((_, i) => i !== index));
    } else {
      setNewPhotoUris((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // ── 영상 선택 ──
  const handlePickVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: '권한 필요', message: '갤러리 접근 권한이 필요해요.' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const durSec = asset.duration ? asset.duration / 1000 : 0;
      if (durSec > MAX_VIDEO_DURATION_SEC) {
        dialog.alert({ title: '영상이 너무 길어요', message: '2분 이하의 영상만 넣을 수 있어요.' });
        return;
      }
      setNewVideoUri(asset.uri);
      setExistingVideoUrl(null);
      setVideoMediaId(null);
    }
  };

  const handleRecordVideo = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: '권한 필요', message: '카메라 접근 권한이 필요해요.' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: MAX_VIDEO_DURATION_SEC,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const durSec = asset.duration ? asset.duration / 1000 : 0;
      if (durSec > MAX_VIDEO_DURATION_SEC) {
        dialog.alert({ title: '영상이 너무 길어요', message: '2분 이하의 영상만 넣을 수 있어요.' });
        return;
      }
      setNewVideoUri(asset.uri);
      setExistingVideoUrl(null);
      setVideoMediaId(null);
    }
  };

  const handleRemoveVideo = () => {
    setShowVideoPreview(false);
    setNewVideoUri(null);
    setExistingVideoUrl(null);
    setVideoMediaId(null);
  };

  // ── 음성 녹음 ──
  const handleToggleRecord = async () => {
    if (recording) {
      // 중지
      try {
        const rec = recordingRef.current;
        if (rec) {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          recordingRef.current = null;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
          if (uri) {
            setRecordedAudioUri(uri);
            setAudioUrl(null);
            setAudioR2Key(null);
          }
        }
      } catch (e) {
        dialog.alert({ title: '녹음에 실패했어요', message: '다시 시도해 주세요.' });
      } finally {
        setRecording(false);
      }
      return;
    }
    // 시작
    try {
      await stopPreviewAudio();
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        dialog.alert({ title: '마이크 권한이 필요해요', message: '휴대폰 설정에서 마이크 권한을 켜 주세요.' });
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await rec.startAsync();
      recordingRef.current = rec;
      setRecording(true);
    } catch (e) {
      setRecording(false);
      dialog.alert({ title: '녹음을 시작할 수 없어요', message: '잠시 후 다시 시도해 주세요.' });
    }
  };

  const handleRemoveAudio = async () => {
    await stopPreviewAudio();
    setRecordedAudioUri(null);
    setAudioUrl(null);
    setAudioR2Key(null);
  };

  const hasAudio = !!recordedAudioUri || !!audioUrl;
  const hasVideo = !!newVideoUri || !!existingVideoUrl;

  // ── 저장 ──
  const handleSave = async () => {
    if (!user) return;
    if (recording) {
      dialog.alert({ title: '녹음 중이에요', message: '녹음을 멈춘 뒤 저장해 주세요.' });
      return;
    }
    setSaving(true);
    try {
      // 1) 신규 사진 업로드
      setSaveStage('사진 저장 중');
      const uploadedPhotos: string[] = [...photoUrls];
      for (const uri of newPhotoUris) {
        const compressed = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 1280 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
        );
        const res = await uploadPhoto(compressed.uri, patientId);
        uploadedPhotos.push(res.url);
      }

      // 2) 신규 음성 업로드
      let finalAudioUrl = audioUrl;
      let finalAudioKey = audioR2Key;
      if (recordedAudioUri) {
        setSaveStage('음성 저장 중');
        const res = await uploadSound(recordedAudioUri, user.id, 'audio/m4a', UPLOAD_TIMEOUT_MS);
        finalAudioUrl = res.url;
        finalAudioKey = res.key;
      }

      // 3) 신규 영상 업로드 + media_logs(source='diary') 행 생성
      let finalVideoMediaId = videoMediaId;
      if (newVideoUri) {
        setSaveStage('영상 저장 중');
        let videoUri = newVideoUri;
        try {
          videoUri = await VideoCompressor.compress(newVideoUri, {
            compressionMethod: 'manual',
            maxSize: 1280,
            bitrate: 1500000,
          });
        } catch (_) {
          // 압축 실패 시 원본 사용
        }
        const res = await uploadVideo(videoUri, patientId, 'body_state', UPLOAD_TIMEOUT_MS);
        const { data: inserted, error: mlError } = await supabase
          .from('media_logs')
          .insert({
            patient_id: patientId,
            logged_by: user.id,
            r2_url: res.url,
            r2_key: res.key,
            expires_at: res.expires_at,
            media_type: 'video',
            category: 'body_state',
            logged_at: new Date(`${dateStr}T12:00:00.000+09:00`).toISOString(),
            source: 'diary',
          } as any)
          .select('id')
          .single();
        if (mlError) throw new Error(mlError.message);
        finalVideoMediaId = (inserted as any)?.id ?? null;
      }

      setSaveStage('저장 중');
      await onSaved({
        text: text.trim(),
        audioUrl: finalAudioUrl,
        audioR2Key: finalAudioKey,
        photoUrls: uploadedPhotos,
        videoMediaId: finalVideoMediaId,
      });
    } catch (e: any) {
      dialog.alert({
        title: '저장에 실패했어요',
        message:
          e?.message === 'UPLOAD_TIMEOUT'
            ? '인터넷 연결이 느려요.\n와이파이 연결 후 다시 시도해 주세요.'
            : e?.message ?? '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSaving(false);
      setSaveStage(null);
    }
  };

  // ── 삭제 (내가 쓴 글) ──
  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: '글 삭제',
      message: '이 날의 글을 삭제할까요?',
      destructive: true,
      confirmText: '삭제',
      cancelText: '취소',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await stopPreviewAudio();
      await onDeleted();
    } catch (e: any) {
      dialog.alert({ title: '삭제에 실패했어요', message: e?.message ?? '잠시 후 다시 시도해 주세요.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.editorSafe} edges={['top', 'bottom']}>
        <TopBar title={existing ? '일기 수정' : '일기 작성'} showClose />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.flex1}
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 무테 텍스트영역 (괘선 느낌) */}
            <TextInput
              style={styles.editorInput}
              value={text}
              onChangeText={setText}
              placeholder="오늘 하루는 어떠셨나요?"
              placeholderTextColor={Journal.placeholder}
              multiline
              textAlignVertical="top"
            />

            {/* 조용한 첨부 칩 한 줄 */}
            <View style={styles.attachChipRow}>
              <TouchableOpacity
                style={[styles.attachChip, recording && styles.attachChipActive]}
                onPress={handleToggleRecord}
                activeOpacity={0.8}
              >
                <Text style={[styles.attachChipText, recording && styles.attachChipTextActive]}>
                  {recording ? '⏹ 녹음 멈추기' : hasAudio ? '🎙 음성 ✓' : '🎙 음성'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachChip} onPress={handleAddPhoto} activeOpacity={0.8}>
                <Text style={styles.attachChipText}>📷 사진</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.attachChip}
                onPress={hasVideo ? handleRemoveVideo : handlePickVideo}
                activeOpacity={0.8}
              >
                <Text style={styles.attachChipText}>{hasVideo ? '🎬 영상 ✓' : '🎬 영상'}</Text>
              </TouchableOpacity>
            </View>

            {/* 음성 첨부됨 표시 + 미리듣기 */}
            {hasAudio && !recording && (
              <View style={styles.attachedRow}>
                <Ionicons name="mic" size={22} color={Journal.accent} />
                <TouchableOpacity
                  style={styles.audioPreviewBtn}
                  onPress={handlePreviewAudio}
                  activeOpacity={0.8}
                >
                  <Ionicons name={previewPlaying ? 'pause' : 'play'} size={18} color={Journal.accent} />
                  <Text style={styles.audioPreviewText}>{previewPlaying ? '멈춤' : '들어보기'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleRemoveAudio} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>빼기</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 영상 첨부됨 표시 + 미리보기(탭하면 재생) */}
            {hasVideo ? (
              <View style={styles.attachedRow}>
                <TouchableOpacity
                  style={styles.videoPreviewFrame}
                  activeOpacity={0.85}
                  onPress={() => setShowVideoPreview(true)}
                >
                  <View style={styles.videoPreviewInner}>
                    <View style={styles.playCircle}>
                      <Ionicons name="play" size={18} color="#fff" />
                    </View>
                  </View>
                </TouchableOpacity>
                <Text style={styles.attachedText}>영상이 첨부되었어요</Text>
                <TouchableOpacity onPress={handleRemoveVideo} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>빼기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.recordVideoLink} onPress={handleRecordVideo} activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={20} color={Journal.inkSoft} />
                <Text style={styles.recordVideoLinkText}>영상 촬영하기</Text>
              </TouchableOpacity>
            )}

            {/* 사진 미리보기 */}
            {(photoUrls.length > 0 || newPhotoUris.length > 0) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
                <View style={styles.thumbRow}>
                  {photoUrls.map((url, i) => (
                    <View key={`ep-${i}`} style={styles.editorThumbWrap}>
                      <Image source={{ uri: url }} style={styles.editorThumb} />
                      <TouchableOpacity style={styles.thumbRemove} onPress={() => handleRemovePhoto(i, true)}>
                        <Ionicons name="close-circle" size={24} color={Journal.accent} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {newPhotoUris.map((uri, i) => (
                    <View key={`np-${i}`} style={styles.editorThumbWrap}>
                      <Image source={{ uri }} style={styles.editorThumb} />
                      <TouchableOpacity style={styles.thumbRemove} onPress={() => handleRemovePhoto(i, false)}>
                        <Ionicons name="close-circle" size={24} color={Journal.accent} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {/* 내가 쓴 글일 때만 — 조용한 삭제 버튼 (주연 아님) */}
            {existing && (
              <TouchableOpacity
                style={styles.deleteEntryLink}
                onPress={handleDelete}
                activeOpacity={0.7}
                disabled={saving || deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={Journal.inkSoft} />
                ) : (
                  <Text style={styles.deleteEntryText}>이 날의 글 삭제</Text>
                )}
              </TouchableOpacity>
            )}

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={styles.editorBottom}>
            <TouchableOpacity
              style={[styles.saveBtn, (saving || deleting) && styles.saveBtnDisabled]}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving || deleting}
            >
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.saveBtnText}>{saveStage ?? '저장 중'}</Text>
                </View>
              ) : (
                <Text style={styles.saveBtnText}>저장</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* 첨부 영상 미리보기 (풀스크린) — 로컬 신규 uri 우선, 없으면 기존 url */}
        {showVideoPreview && (newVideoUri || existingVideoUrl) && (
          <FullscreenVideoModal
            url={(newVideoUri ?? existingVideoUrl) as string}
            onClose={() => setShowVideoPreview(false)}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Journal.page },
  flex1: { flex: 1 },
  scroll: { flex: 1, backgroundColor: Journal.page },
  scrollContent: { paddingHorizontal: 22, paddingTop: 18 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Journal.page },

  // ── 날짜 헤더 §11-3 (우아한 serif, 한 장의 페이지) ──
  dateHeader: {
    backgroundColor: Journal.page,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },
  dateHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  navArrowBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowDisabled: { opacity: 0.4 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateTitle: { fontFamily: SERIF, fontSize: 22, fontWeight: '600', lineHeight: 30, color: Journal.ink },
  todayChip: {
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 9,
    paddingVertical: 2,
    borderRadius: 11,
  },
  todayChipText: { fontFamily: SERIF, fontSize: 13, fontWeight: '600', color: Journal.accent },
  dateRule: { height: 1, width: '40%', backgroundColor: Journal.rule, marginTop: 9 },
  dateRightCol: { flexDirection: 'row', alignItems: 'center' },
  calBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  // ── 한마디 비어있음 ──
  emptyEntryText: { fontFamily: SERIF, fontSize: 16, lineHeight: 26, color: Journal.inkSoft, marginBottom: 8 },

  // ── 한마디 글 블록 §11-3 (카드 아님, 페이지 안의 글) ──
  entryRule: { height: 1, backgroundColor: Journal.rule, marginVertical: 28 },
  entryBlock: {},
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  mineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Journal.mine },
  entryAuthor: { fontFamily: SERIF, fontSize: 15, fontWeight: '600', lineHeight: 20, color: Journal.inkSoft },
  entryRole: { fontSize: 12, fontWeight: '500', color: Journal.inkFaint },
  entryText: { fontFamily: SERIF, fontSize: 16, fontWeight: '400', lineHeight: 26, color: Journal.ink },

  // ── 음성: surface 인라인 pill §11-3 ──
  audioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    marginTop: 14,
  },
  audioPillText: { fontSize: 14, fontWeight: '600', color: Journal.accent },

  // ── 사진·영상 액자 프레임 §11-3 (surface 매트 + 옅은 그림자, radius 3) ──
  frameRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  photoFrame: {
    width: 74,
    height: 74,
    backgroundColor: Journal.surface,
    padding: 5,
    borderRadius: 3,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  photoFrameImg: { flex: 1, borderRadius: 1, backgroundColor: Journal.rule },
  photoCountBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    backgroundColor: 'rgba(58,49,40,0.72)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  photoCountText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  videoFrame: {
    width: 74,
    height: 74,
    backgroundColor: Journal.surface,
    padding: 5,
    borderRadius: 3,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  videoFrameInner: {
    flex: 1,
    borderRadius: 1,
    backgroundColor: Journal.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 사진 라이트박스 모달 (ImageGalleryViewer 호스팅) ──
  photoModalBg: { flex: 1, backgroundColor: '#000' },
  photoModalHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  photoModalBody: { flex: 1, justifyContent: 'center' },
  photoCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    margin: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    minWidth: 90,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  photoCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },

  // ── 풀스크린 영상 ──
  videoModalBg: { flex: 1, backgroundColor: '#000' },
  videoModalHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  videoCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    margin: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
    minWidth: 90,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  videoCloseText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  fullscreenVideo: { flex: 1 },

  // ── 쓰기/수정 진입 §11-3 (조용한 한 줄) ──
  writeEntryLink: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 24,
  },
  writeEntryText: { fontFamily: SERIF, fontSize: 15, fontWeight: '600', color: Journal.accent },

  // ── 건강 데이터 = 하단 각주 §11-3 ──
  footnote: { marginTop: 36 },
  footnoteRule: { height: 1, backgroundColor: Journal.rule, marginBottom: 12 },
  footnoteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  footnoteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Journal.inkFaint,
    letterSpacing: 1.5,
  },
  trendLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingVertical: 4,
  },
  trendLinkText: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  footnoteRows: { gap: 10 },
  footnoteText: { fontSize: 13, fontWeight: '500', lineHeight: 20, color: Journal.inkFaint },
  footnoteScoreRow: { flexDirection: 'row', alignItems: 'center' },
  onOffBlock: { gap: 8 },
  onOffLineLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Journal.inkFaint,
    width: 48,
  },

  scoreScroll: { flexShrink: 1 },
  scoreRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingRight: 4 },
  scoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Journal.accentSoft,
  },
  scoreChipLabel: { fontSize: 13, fontWeight: '600', color: Journal.inkSoft },
  scoreChipScore: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  // ── 에디터 (펼친 일기장) §11-4 ──
  editorSafe: { flex: 1, backgroundColor: Journal.pageDeep },
  editorContent: { padding: 20 },
  editorInput: {
    backgroundColor: Journal.surface,
    borderRadius: 10,
    padding: 18,
    fontFamily: SERIF,
    fontSize: 16,
    lineHeight: 26,
    color: Journal.ink,
    minHeight: 220,
  },
  attachChipRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  attachChip: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: Journal.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachChipActive: { backgroundColor: Journal.accent },
  attachChipText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft },
  attachChipTextActive: { color: '#FAF5E9' },
  recordVideoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingVertical: 10,
    marginTop: 12,
  },
  recordVideoLinkText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  attachedText: { fontSize: 14, fontWeight: '600', color: Journal.ink, flex: 1 },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, justifyContent: 'center' },
  removeBtnText: { fontSize: 14, fontWeight: '700', color: Journal.accent },

  // 음성 미리듣기 버튼 (에디터 내부, surface 톤)
  audioPreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
  },
  audioPreviewText: { fontSize: 14, fontWeight: '600', color: Journal.accent },

  // 첨부 영상 미리보기 작은 액자 프레임
  videoPreviewFrame: {
    width: 56,
    height: 56,
    backgroundColor: Journal.surface,
    padding: 4,
    borderRadius: 3,
  },
  videoPreviewInner: {
    flex: 1,
    borderRadius: 1,
    backgroundColor: Journal.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 조용한 삭제 링크 (에디터 하단)
  deleteEntryLink: {
    alignSelf: 'center',
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 28,
  },
  deleteEntryText: { fontSize: 14, fontWeight: '600', color: Journal.inkSoft, textDecorationLine: 'underline' },

  thumbRow: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  editorThumbWrap: { position: 'relative' },
  editorThumb: {
    width: 76,
    height: 76,
    borderRadius: 4,
    backgroundColor: Journal.rule,
  },
  thumbRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: Journal.surface, borderRadius: 12 },

  editorBottom: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
    backgroundColor: Journal.pageDeep,
  },
  saveBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FAF5E9' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
