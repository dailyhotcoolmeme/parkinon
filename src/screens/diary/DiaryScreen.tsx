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

// ─── 일기장 로컬 팔레트 (DiaryScreen 전용, 전역 Colors 미변경 / 녹색 0%) ───────────
const Journal = {
  page: '#F7F1E3', // 화면 배경(크림 종이)
  pageDeep: '#F1E8D3', // 작성 모달 배경
  card: '#FFFDF7', // 한마디 카드 표면
  rule: '#E3D7BC', // 괘선·구분선·날짜 밑줄
  cardBorder: '#EADFC6', // 카드 테두리 1px
  ink: '#33291E', // 본문 잉크(따뜻한 진갈색)
  inkSoft: '#6B5D4A', // 보조 텍스트
  inkFaint: '#9A8B73', // 자동 기록 본문
  placeholder: '#B6A68A', // 에디터 플레이스홀더
  accent: '#C2613D', // 테라코타(저자명·추세보기·저장·액티브)
  accentSoft: '#F0E0D2', // 악센트 배경칩
  mine: '#A8843C', // 내 카드 좌측 북마크 바(머스터드)
  videoScrim: 'rgba(38,28,18,0.45)', // 영상 썸네일 위
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

  const { autoSummary, entries, loading, patientId, saveMyEntry } = useDiary(dateStr);

  // 미래 날짜로는 이동 금지
  const isToday = dateStr === todayStr;
  const canGoNext = dateStr < todayStr;

  const myEntry = entries.find((e) => e.author_id === user?.id) ?? null;

  const dt = dateStrToDate(dateStr);
  const monthDay = `${dt.getMonth() + 1} / ${dt.getDate()}`;
  const weekday = WEEKDAYS_FULL[dt.getDay()];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="일기" showBack />

      {/* ── 날짜 헤더 (크림 종이 톤) ── */}
      <View style={styles.dateHeader}>
        <View style={styles.dateHeaderRow}>
          <TouchableOpacity
            style={styles.navArrowBtn}
            onPress={() => setDateStr(shiftDate(dateStr, -1))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={28} color={Journal.inkSoft} />
          </TouchableOpacity>

          <View style={styles.dateCenter}>
            <View style={styles.dateTopRow}>
              <Text style={styles.dateNumber}>{monthDay}</Text>
              {isToday && <Text style={styles.todayChip}>오늘</Text>}
            </View>
            <Text style={styles.dateWeekday}>{weekday}</Text>
            <View style={styles.dateRule} />
          </View>

          <View style={styles.dateRightCol}>
            <TouchableOpacity
              style={[styles.navArrowBtn, !canGoNext && styles.navArrowDisabled]}
              onPress={() => canGoNext && setDateStr(shiftDate(dateStr, 1))}
              disabled={!canGoNext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-forward" size={28} color={canGoNext ? Journal.inkSoft : Journal.rule} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.calBtn}
              onPress={() => setShowDatePicker(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="calendar-outline" size={22} color={Journal.inkSoft} />
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
          {/* ── 한마디 (HERO, 위로) ── */}
          {entries.length === 0 && (
            <View style={styles.emptyEntryCard}>
              <Text style={styles.emptyEntryText}>아직 적은 한마디가 없어요.</Text>
            </View>
          )}

          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} isMine={entry.author_id === user?.id} />
          ))}

          {/* 내가 안 썼으면 쓰기 진입 / 썼으면 수정 */}
          <TouchableOpacity style={styles.writeEntryCard} onPress={() => setShowEditor(true)} activeOpacity={0.85}>
            <Text style={styles.writeEntryText}>
              {myEntry ? '✏️ 내 한마디 수정하기' : '✏️ 오늘 한마디 쓰기'}
            </Text>
          </TouchableOpacity>

          {/* ── 오늘의 기록 (자동, 조용한 푸터 스트립) ── */}
          <AutoFooter summary={autoSummary} dialog={dialog} />

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
        />
      )}
    </SafeAreaView>
  );
}

// ─── 오늘의 기록 (자동) — 조용한 푸터 스트립 ───────────────────────────────────

function AutoFooter({ summary, dialog }: { summary: AutoSummary | null; dialog: ReturnType<typeof useDialog> }) {
  if (!summary) return null;
  const hasAny = summary.med.count > 0 || summary.onOff.scores.length > 0 || summary.exercise.length > 0;

  return (
    <View style={styles.autoFooter}>
      {/* 헤더: 좌 라벨 / 우 추세보기 pill */}
      <View style={styles.autoHeaderRow}>
        <Text style={styles.autoLabel}>오늘의 기록</Text>
        <WebTrendPill dialog={dialog} />
      </View>

      {!hasAny ? (
        <Text style={styles.autoEmptyText}>이 날은 자동으로 모인 기록이 없어요.</Text>
      ) : (
        <View style={styles.autoRows}>
          {summary.med.count > 0 && (
            <View style={styles.autoRow}>
              <Text style={styles.autoEmoji}>💊</Text>
              <Text style={styles.autoText}>
                약 복용 {summary.med.count}회
                {summary.med.times.length > 0 ? ` · ${summary.med.times.join(', ')}` : ''}
              </Text>
            </View>
          )}

          {summary.onOff.scores.length > 0 && (
            <View style={styles.autoRow}>
              <Text style={styles.autoEmoji}>😊</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.scoreScroll}
                contentContainerStyle={styles.scoreRow}
              >
                {summary.onOff.scores.map((s, i) => (
                  <View key={i} style={styles.scoreChip}>
                    <Text style={styles.scoreChipLabel}>{s.label}</Text>
                    <Text style={styles.scoreChipScore}>{s.score}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {summary.exercise.length > 0 && (
            <View style={styles.autoRow}>
              <Text style={styles.autoEmoji}>🏃</Text>
              <Text style={styles.autoText}>
                {summary.exercise.map((e) => `${e.type} ${e.minutes}분`).join(', ')}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── 웹 추세 보기 pill (오늘의 기록 헤더 우측) ─────────────────────────────────

function WebTrendPill({ dialog }: { dialog: ReturnType<typeof useDialog> }) {
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
    <TouchableOpacity style={styles.trendPill} onPress={handleWebOpen} activeOpacity={0.8} disabled={webLoading}>
      {webLoading ? (
        <ActivityIndicator size="small" color={Journal.accent} />
      ) : (
        <>
          <Text style={styles.trendPillText}>추세보기</Text>
          <Ionicons name="chevron-forward" size={16} color={Journal.accent} />
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── 한마디 카드 (HERO) ───────────────────────────────────────────────────────

function EntryCard({ entry, isMine }: { entry: DiaryEntry; isMine: boolean }) {
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

  const roleIcon = entry.author_role === 'caregiver' ? '🧑' : '👤';
  const roleLabel = entry.author_role === 'caregiver' ? '보호자' : '환자';

  return (
    <View style={styles.entryCard}>
      {isMine && <View style={styles.mineBookmark} />}

      <View style={styles.entryHeader}>
        <Text style={styles.entryAuthor}>
          {roleIcon} {entry.author_name}
        </Text>
        <Text style={styles.entryRole}>{roleLabel}</Text>
      </View>

      {!!entry.text && <Text style={styles.entryText}>{entry.text}</Text>}

      {/* 음성: 인라인 pill */}
      {entry.audio_url && (
        <TouchableOpacity style={styles.audioPill} onPress={handlePlayAudio} activeOpacity={0.8}>
          <Ionicons name={playing ? 'stop' : 'play'} size={20} color={Journal.accent} />
          <Text style={styles.audioPillText}>{playing ? '음성 멈춤' : '음성 듣기'}</Text>
        </TouchableOpacity>
      )}

      {/* 사진: 폴라로이드 프레임 → ImageGalleryViewer 라이트박스 */}
      {entry.photo_urls.length > 0 && (
        <View style={styles.polaroidFrame}>
          <ImageGalleryViewer urls={entry.photo_urls} />
        </View>
      )}

      {/* 영상: 썸네일 + play → 풀스크린 */}
      {entry.video_url && (
        <TouchableOpacity style={styles.videoThumb} activeOpacity={0.85} onPress={() => setShowVideo(true)}>
          <View style={styles.videoScrim}>
            <View style={styles.playCircle}>
              <Ionicons name="play" size={28} color="#fff" />
            </View>
            <Text style={styles.videoThumbText}>영상 보기</Text>
          </View>
        </TouchableOpacity>
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
}

function DiaryEditorModal({ visible, dateStr, patientId, existing, onClose, onSaved }: EditorProps) {
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

  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

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

  const handleRemoveAudio = () => {
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.editorSafe} edges={['top', 'bottom']}>
        <TopBar title="오늘 한마디" showClose />
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

            {/* 음성 첨부됨 표시 */}
            {hasAudio && !recording && (
              <View style={styles.attachedRow}>
                <Ionicons name="mic" size={22} color={Journal.accent} />
                <Text style={styles.attachedText}>음성이 첨부되었어요</Text>
                <TouchableOpacity onPress={handleRemoveAudio} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>빼기</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 영상 첨부됨 표시 + 촬영 옵션 */}
            {hasVideo ? (
              <View style={styles.attachedRow}>
                <Ionicons name="videocam" size={22} color={Journal.accent} />
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

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={styles.editorBottom}>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}
            >
              {saving ? (
                <View style={styles.savingRow}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.saveBtnText}>{saveStage ?? '저장 중'}</Text>
                </View>
              ) : (
                <Text style={styles.saveBtnText}>저장하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Journal.page },
  flex1: { flex: 1 },
  scroll: { flex: 1, backgroundColor: Journal.page },
  scrollContent: { padding: 18, paddingTop: 14 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Journal.page },

  // 날짜 헤더 (크림 종이)
  dateHeader: {
    backgroundColor: Journal.page,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
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
  dateTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dateNumber: { fontFamily: SERIF, fontSize: 28, fontWeight: '700', color: Journal.ink },
  todayChip: {
    fontFamily: SERIF,
    fontSize: 14,
    fontWeight: '700',
    color: Journal.accent,
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  dateWeekday: { fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: Journal.inkSoft, marginTop: 2 },
  dateRule: { height: 1, width: '60%', backgroundColor: Journal.rule, marginTop: 8 },
  dateRightCol: { flexDirection: 'row', alignItems: 'center' },
  calBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },

  // 한마디 비어있음
  emptyEntryCard: {
    backgroundColor: Journal.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Journal.cardBorder,
    padding: 24,
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyEntryText: { fontFamily: SERIF, fontSize: 17, color: Journal.inkSoft },

  // 한마디 EntryCard
  entryCard: {
    backgroundColor: Journal.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Journal.cardBorder,
    padding: 20,
    marginBottom: 14,
    overflow: 'hidden',
  },
  mineBookmark: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Journal.mine,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  entryAuthor: { fontFamily: SERIF, fontSize: 18, fontWeight: '600', color: Journal.accent },
  entryRole: {
    fontSize: 13,
    fontWeight: '600',
    color: Journal.inkSoft,
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  entryText: { fontFamily: SERIF, fontSize: 22, fontWeight: '400', color: Journal.ink, lineHeight: 36 },

  // 음성 pill
  audioPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: Journal.accentSoft,
    marginTop: 14,
  },
  audioPillText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  // 사진 폴라로이드 프레임
  polaroidFrame: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Journal.cardBorder,
    borderRadius: 8,
    padding: 8,
    paddingBottom: 16,
    marginTop: 14,
    shadowColor: '#3A2E1E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 2,
  },

  // 영상 썸네일
  videoThumb: {
    height: 180,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 14,
    backgroundColor: Journal.ink,
  },
  videoScrim: {
    flex: 1,
    backgroundColor: Journal.videoScrim,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  playCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoThumbText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // 풀스크린 영상
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

  // 쓰기/수정 진입 (테라코타 dashed)
  writeEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Journal.accent,
    borderStyle: 'dashed',
    backgroundColor: Journal.card,
    minHeight: 56,
    marginBottom: 22,
  },
  writeEntryText: { fontSize: 18, fontWeight: '700', color: Journal.accent },

  // 오늘의 기록 (자동 푸터)
  autoFooter: {
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
    paddingTop: 16,
    marginTop: 4,
  },
  autoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  autoLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Journal.inkSoft,
    letterSpacing: 2,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: Journal.accentSoft,
  },
  trendPillText: { fontSize: 14, fontWeight: '700', color: Journal.accent },

  autoRows: { gap: 12 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  autoEmoji: { fontSize: 20 },
  autoText: { fontSize: 16, fontWeight: '500', color: Journal.inkFaint, flex: 1 },
  autoEmptyText: { fontSize: 16, color: Journal.inkFaint },

  scoreScroll: { flex: 1 },
  scoreRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingRight: 4 },
  scoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: Journal.accentSoft,
  },
  scoreChipLabel: { fontSize: 15, fontWeight: '600', color: Journal.inkSoft },
  scoreChipScore: { fontSize: 15, fontWeight: '700', color: Journal.accent },

  // ── 에디터 (펼친 일기장) ──
  editorSafe: { flex: 1, backgroundColor: Journal.pageDeep },
  editorContent: { padding: 20 },
  editorInput: {
    backgroundColor: Journal.card,
    borderWidth: 1,
    borderColor: Journal.cardBorder,
    borderRadius: 12,
    padding: 18,
    fontFamily: SERIF,
    fontSize: 20,
    lineHeight: 32,
    color: Journal.ink,
    minHeight: 200,
  },
  attachChipRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  attachChip: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Journal.card,
    borderWidth: 1,
    borderColor: Journal.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachChipActive: { backgroundColor: Journal.accent, borderColor: Journal.accent },
  attachChipText: { fontSize: 16, fontWeight: '700', color: Journal.inkSoft },
  attachChipTextActive: { color: '#fff' },
  recordVideoLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 48,
    paddingVertical: 10,
    marginTop: 12,
  },
  recordVideoLinkText: { fontSize: 16, fontWeight: '600', color: Journal.inkSoft },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: Journal.accentSoft,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  attachedText: { fontSize: 16, fontWeight: '700', color: Journal.ink, flex: 1 },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, justifyContent: 'center' },
  removeBtnText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  thumbRow: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  editorThumbWrap: { position: 'relative' },
  editorThumb: {
    width: 84,
    height: 84,
    borderRadius: 10,
    backgroundColor: Journal.rule,
    borderWidth: 1,
    borderColor: Journal.cardBorder,
  },
  thumbRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: '#fff', borderRadius: 12 },

  editorBottom: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
    backgroundColor: Journal.pageDeep,
  },
  saveBtn: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 19, fontWeight: '800', color: '#fff' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
