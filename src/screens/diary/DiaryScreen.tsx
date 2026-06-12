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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video as AVVideo, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Video as VideoCompressor } from 'react-native-compressor';
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

// mm:ss 포맷 (음성 플레이어 시간 라벨)
function formatMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── 일기장 로컬 헤더 (공용 TopBar 대체, 배경=본문색) §11 ──────────────────────
// 좌=뒤로/back, 중앙=제목(serif), 우=액션 버튼들. 배경이 본문과 같아야 함.
function DiaryHeader({
  title,
  bg,
  onLeftPress,
  rightComponent,
}: {
  title: string;
  bg: string;
  onLeftPress: () => void;
  rightComponent?: React.ReactNode;
}) {
  return (
    <View style={[styles.diaryHeader, { backgroundColor: bg }]}>
      <TouchableOpacity
        style={styles.diaryHeaderBack}
        onPress={onLeftPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Ionicons name="arrow-back" size={24} color={Journal.inkSoft} />
        <Text style={styles.diaryHeaderBackText}>뒤로</Text>
      </TouchableOpacity>
      <Text style={styles.diaryHeaderTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.diaryHeaderRight}>{rightComponent}</View>
    </View>
  );
}

// ─── 음성 플레이어 (재생/일시정지 + 진행바 + 시간) — 읽기·에디터 공용 §11 ──────
function AudioPlayer({ uri }: { uri: string }) {
  const dialog = useDialog();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  // uri가 바뀌면(다시 녹음 등) 기존 사운드 정리
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPlaying(false);
      setPosition(0);
      setDuration(0);
    };
  }, [uri]);

  const onStatus = (s: any) => {
    if (!s.isLoaded) return;
    if (typeof s.positionMillis === 'number') setPosition(s.positionMillis);
    if (typeof s.durationMillis === 'number' && s.durationMillis > 0) setDuration(s.durationMillis);
    if (s.didJustFinish) {
      setPlaying(false);
      setPosition(0);
      soundRef.current?.setPositionAsync(0).catch(() => {});
      soundRef.current?.pauseAsync().catch(() => {});
    }
  };

  const handleToggle = async () => {
    try {
      if (soundRef.current) {
        const st = await soundRef.current.getStatusAsync();
        if (st.isLoaded && st.isPlaying) {
          await soundRef.current.pauseAsync();
          setPlaying(false);
        } else {
          await soundRef.current.playAsync();
          setPlaying(true);
        }
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(onStatus);
      setPlaying(true);
    } catch (e) {
      setPlaying(false);
      dialog.alert({ title: '재생할 수 없어요', message: '다시 시도해 주세요.' });
    }
  };

  const pct = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.audioPlayer}>
      <TouchableOpacity style={styles.audioPlayCircle} onPress={handleToggle} activeOpacity={0.85}>
        <Ionicons name={playing ? 'pause' : 'play'} size={15} color="#fff" />
      </TouchableOpacity>
      <View style={styles.audioBarTrack}>
        <View style={[styles.audioBarFill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={styles.audioTimeText}>
        {formatMs(position)} / {formatMs(duration)}
      </Text>
    </View>
  );
}

export function DiaryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();

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
      <DiaryHeader
        title="일기"
        bg={Journal.page}
        onLeftPress={() => navigation.goBack()}
        rightComponent={
          <TouchableOpacity
            onPress={() => setShowEditor(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerActionBtn}
          >
            <Ionicons name="create-outline" size={20} color={Journal.accent} />
            <Text style={styles.headerActionText}>{myEntry ? '수정' : '작성'}</Text>
          </TouchableOpacity>
        }
      />

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
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ── */}
          <TodayRecordBox summary={autoSummary} dialog={dialog} />

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

// ─── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ─────────────────────────────
// 약복용/몸상태/기분/운동을 시간대별 평균으로 한 줄씩. 데이터 없는 줄은 통째로 생략.

function TodayRecordBox({ summary, dialog }: { summary: AutoSummary | null; dialog: ReturnType<typeof useDialog> }) {
  if (!summary) return null;

  const hasMed = summary.med.count > 0;
  const hasBody = summary.bodyByTime.length > 0;
  const hasMood = summary.moodByTime.length > 0;
  const hasExercise = summary.exercise.length > 0;
  const hasAny = hasMed || hasBody || hasMood || hasExercise;

  return (
    <View style={styles.recBox}>
      {/* 헤더: 좌=• 오늘의 기록 • / 우=추세보기 › */}
      <View style={styles.recHead}>
        <Text style={styles.recTitle}>• 오늘의 기록 •</Text>
        <WebTrendLink dialog={dialog} />
      </View>

      {!hasAny ? (
        <Text style={styles.recEmpty}>이 날은 모인 기록이 없어요</Text>
      ) : (
        <>
          {hasMed && (
            <View style={styles.recRow}>
              <Text style={styles.recLab}>💊 약복용 {summary.med.count}회</Text>
              <Text style={styles.recVal}>{summary.med.times.join(' | ')}</Text>
            </View>
          )}
          {hasBody && (
            <View style={styles.recRow}>
              <Text style={styles.recLab}>😊 몸상태</Text>
              <Text style={styles.recVal}>
                {summary.bodyByTime.map((s) => `${s.label} ${s.avg}점`).join(' | ')}
              </Text>
            </View>
          )}
          {hasMood && (
            <View style={styles.recRow}>
              <Text style={styles.recLab}>🙂 기분상태</Text>
              <Text style={styles.recVal}>
                {summary.moodByTime.map((s) => `${s.label} ${s.avg}점`).join(' | ')}
              </Text>
            </View>
          )}
          {hasExercise && (
            <View style={styles.recRow}>
              <Text style={styles.recLab}>🏃 운동 {summary.exerciseCount}회</Text>
              <Text style={styles.recVal}>
                {summary.exercise.map((e) => `${e.type} ${e.minutes}분`).join(' | ')}
              </Text>
            </View>
          )}
        </>
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
  const [showVideo, setShowVideo] = useState(false);

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

      {/* 사진·영상: 균일한 72×72 정사각 썸네일 (한 줄 wrap) */}
      {(entry.photo_urls.length > 0 || entry.video_url) && (
        <View style={styles.thumbGrid}>
          {entry.photo_urls.map((url, i) => (
            <TouchableOpacity key={`p-${i}`} style={styles.thumbSquare} activeOpacity={0.85} onPress={() => setShowPhotos(true)}>
              <Image source={{ uri: url }} style={styles.thumbSquareImg} />
            </TouchableOpacity>
          ))}
          {entry.video_url && (
            <TouchableOpacity style={styles.thumbSquare} activeOpacity={0.9} onPress={() => setShowVideo(true)}>
              <AVVideo
                source={{ uri: entry.video_url }}
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isMuted
              />
              <View style={styles.videoScrim} />
              <View style={styles.thumbPlayOverlay}>
                <Ionicons name="play" size={18} color={Journal.accent} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 음성: 재생/일시정지 + 진행바 + 시간 */}
      {entry.audio_url && (
        <View style={styles.audioReadWrap}>
          <AudioPlayer uri={entry.audio_url} />
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

// ─── 괘선 종이 (시안 §paper) ───────────────────────────────────────────────────
// RN엔 repeating-linear-gradient가 없으므로, 콘텐츠 높이를 onLayout으로 재서
// 32px 간격마다 1px 가로선 View를 절대배치로 깔고, 그 위에 글·첨부를 얹는다.
const RULE_SPACING = 32;
const PAPER_PT = 14; // paperContent 상단 패딩 = 첫 글줄 시작 y

function RuledPaper({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  // 줄은 각 글줄 박스의 '하단'에 그어서 글이 줄 위에 앉게 한다(노트 괘선).
  const lineCount = Math.max(0, Math.ceil((height - PAPER_PT) / RULE_SPACING));
  return (
    <View
      style={styles.paperFill}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {/* 괘선 레이어 (글·첨부 뒤) */}
      <View style={styles.ruleLayer} pointerEvents="none">
        {Array.from({ length: lineCount }).map((_, i) => (
          <View key={i} style={[styles.ruleLine, { top: PAPER_PT + (i + 1) * RULE_SPACING }]} />
        ))}
      </View>
      {/* 콘텐츠 (글 + 첨부 미리보기) — 괘선 위 */}
      <View style={styles.paperContent}>{children}</View>
    </View>
  );
}

function DiaryEditorModal({ visible, dateStr, patientId, existing, onClose, onSaved, onDeleted }: EditorProps) {
  const { user } = useAuth();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();

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

  // 첨부 영상 미리보기(풀스크린)
  const [showVideoPreview, setShowVideoPreview] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  // 첨부 음성 미리듣기 uri (로컬 녹음 uri 우선, 없으면 기존 audio_url)
  const previewUri = recordedAudioUri ?? audioUrl;

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
      await onDeleted();
    } catch (e: any) {
      dialog.alert({ title: '삭제에 실패했어요', message: e?.message ?? '잠시 후 다시 시도해 주세요.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.editorSafe} edges={['top']}>
        <DiaryHeader
          title={existing ? '일기 수정' : '일기 작성'}
          bg={Journal.pageDeep}
          onLeftPress={onClose}
          rightComponent={
            <View style={styles.headerRightRow}>
              {existing && (
                <TouchableOpacity
                  onPress={handleDelete}
                  disabled={saving || deleting}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  style={styles.headerActionBtn}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color={Journal.inkSoft} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={20} color={Journal.inkSoft} />
                      <Text style={styles.headerActionTextSoft}>삭제</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving || deleting}
                hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                style={styles.headerActionBtn}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={Journal.accent} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={20} color={Journal.accent} />
                    <Text style={styles.headerActionText}>저장</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          }
        />
        <KeyboardAvoidingView
          style={styles.flex1}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.flex1}
            contentContainerStyle={styles.editorContentFill}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 괘선 종이: 글 + 첨부 미리보기가 한 장의 괘선 위에 (시안 §paper) */}
            <RuledPaper>
              <TextInput
                style={styles.editorInput}
                value={text}
                onChangeText={setText}
                placeholder="오늘 하루는 어떠셨나요?"
                placeholderTextColor={Journal.placeholder}
                multiline
                textAlignVertical="top"
              />

              {/* 첨부 미리보기 묶음 — 괘선 위에 그냥 얹힘(정렬 없음) */}
              {(hasAudio || hasVideo || photoUrls.length > 0 || newPhotoUris.length > 0) && (
                <View style={styles.attBlock}>
                  {/* 음성 첨부: 재생/일시정지 + 진행바 + 시간 + ✕ 제거 오버레이 */}
                  {hasAudio && !recording && previewUri && (
                    <View style={styles.attAudioWrap}>
                      <AudioPlayer uri={previewUri} />
                      <TouchableOpacity style={styles.attRemoveX} onPress={handleRemoveAudio}>
                        <Ionicons name="close" size={14} color={Journal.accent} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* 사진·영상 썸네일: 균일 72×72 정사각 + ✕ 제거 오버레이 */}
                  {(photoUrls.length > 0 || newPhotoUris.length > 0 || (hasVideo && (newVideoUri || existingVideoUrl))) && (
                    <View style={styles.thumbGrid}>
                      {photoUrls.map((url, i) => (
                        <View key={`ep-${i}`} style={styles.thumbSquareWrap}>
                          <Image source={{ uri: url }} style={styles.thumbSquare} />
                          <TouchableOpacity style={styles.attRemoveX} onPress={() => handleRemovePhoto(i, true)}>
                            <Ionicons name="close" size={14} color={Journal.accent} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {newPhotoUris.map((uri, i) => (
                        <View key={`np-${i}`} style={styles.thumbSquareWrap}>
                          <Image source={{ uri }} style={styles.thumbSquare} />
                          <TouchableOpacity style={styles.attRemoveX} onPress={() => handleRemovePhoto(i, false)}>
                            <Ionicons name="close" size={14} color={Journal.accent} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      {hasVideo && (newVideoUri || existingVideoUrl) && (
                        <View style={styles.thumbSquareWrap}>
                          <TouchableOpacity style={styles.thumbSquare} activeOpacity={0.85} onPress={() => setShowVideoPreview(true)}>
                            <AVVideo
                              source={{ uri: (newVideoUri ?? existingVideoUrl) as string }}
                              style={StyleSheet.absoluteFill}
                              resizeMode={ResizeMode.COVER}
                              shouldPlay={false}
                              isMuted
                            />
                            <View style={styles.videoScrim} />
                            <View style={styles.thumbPlayOverlay}>
                              <Ionicons name="play" size={16} color={Journal.accent} />
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.attRemoveX} onPress={handleRemoveVideo}>
                            <Ionicons name="close" size={14} color={Journal.accent} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </RuledPaper>
          </ScrollView>

          {/* 도구막대 (키보드 위 고정) — [사진] [동영상] [음성] */}
          <View style={[styles.toolbarBar, { paddingBottom: insets.bottom + 10 }]}>
            <TouchableOpacity style={styles.tool} onPress={handleAddPhoto} activeOpacity={0.8}>
              <Ionicons name="image-outline" size={20} color={Journal.inkSoft} />
              <Text style={styles.toolText}>사진</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tool, hasVideo && styles.toolActive]}
              onPress={hasVideo ? handleRemoveVideo : handlePickVideo}
              activeOpacity={0.8}
            >
              <Ionicons name="videocam-outline" size={20} color={hasVideo ? '#FAF5E9' : Journal.inkSoft} />
              <Text style={[styles.toolText, hasVideo && styles.toolTextActive]}>동영상</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tool, recording && styles.toolActive]}
              onPress={handleToggleRecord}
              activeOpacity={0.8}
            >
              <Ionicons name="mic-outline" size={20} color={recording ? '#FAF5E9' : Journal.inkSoft} />
              <Text style={[styles.toolText, recording && styles.toolTextActive]}>
                {recording ? '멈추기' : '음성'}
              </Text>
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

  // ── 일기장 로컬 헤더 (TopBar 대체) §11 ──
  diaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Journal.rule,
  },
  diaryHeaderBack: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 64 },
  diaryHeaderBackText: { fontSize: 18, fontWeight: '600', color: Journal.inkSoft },
  diaryHeaderTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: SERIF,
    fontSize: 19,
    fontWeight: '600',
    color: Journal.ink,
  },
  diaryHeaderRight: { minWidth: 64, alignItems: 'flex-end' },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, justifyContent: 'center' },
  headerActionText: { fontSize: 18, fontWeight: '700', color: Journal.accent },
  headerActionTextSoft: { fontSize: 18, fontWeight: '700', color: Journal.inkSoft },

  // ── 음성 플레이어 (재생/일시정지 + 진행바 + 시간) 공용 ──
  audioPlayer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
  },
  audioBarTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: Journal.rule,
    overflow: 'hidden',
  },
  audioBarFill: { height: 5, borderRadius: 3, backgroundColor: Journal.accent },
  audioTimeText: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft, minWidth: 78, textAlign: 'right' },
  audioReadWrap: { marginTop: 14, alignSelf: 'stretch' },
  attAudioWrap: { alignSelf: 'stretch', position: 'relative' },

  // ── 균일 72×72 정사각 썸네일 (읽기·에디터 공용) ──
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 },
  thumbSquareWrap: { position: 'relative', width: 72, height: 72 },
  thumbSquare: {
    width: 72,
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.rule,
  },
  thumbSquareImg: { width: '100%', height: '100%' },
  thumbPlayOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    margin: 'auto',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 첨부 제거 ✕ 오버레이 (사진/영상/음성 공용)
  attRemoveX: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
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

  // ── 사진 2열 그리드 (시안) ──
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  gridPhoto: {
    width: '48%',
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.rule,
  },
  gridPhotoImg: { width: '100%', height: '100%' },

  // ── 음성: 원형 ▶ + 파형 + 라벨 pill (시안) ──
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
  audioPlayCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioWave: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  audioWaveBar: { width: 3, borderRadius: 2, backgroundColor: Journal.inkFaint },
  audioPillText: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft },

  // ── 영상: 62% 포스터 + 스크림 + 흰 재생버튼 (시안) ──
  videoPoster: {
    width: '62%',
    aspectRatio: 16 / 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Journal.rule,
    overflow: 'hidden',
    backgroundColor: Journal.ink,
    marginTop: 14,
  },
  videoScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(38,28,18,0.32)' },
  videoPlayBig: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    margin: 'auto',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },

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

  // ── 오늘의 기록 = 상단 색다른 박스 (시안 §recBox) ──
  recBox: {
    backgroundColor: '#EBDFC2',
    borderWidth: 1,
    borderColor: '#D8C9A4',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  recHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  recTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    color: Journal.inkSoft,
  },
  recRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 9,
  },
  recLab: { fontSize: 13, fontWeight: '700', lineHeight: 20, color: Journal.ink },
  recVal: { fontSize: 13, fontWeight: '500', lineHeight: 20, color: Journal.inkSoft, flexShrink: 1 },
  recEmpty: { fontSize: 13, fontWeight: '500', lineHeight: 20, color: Journal.inkFaint },

  trendLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingVertical: 4,
  },
  trendLinkText: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  // 상단 우측 작성/수정 버튼
  topWriteBtn: { paddingHorizontal: 8, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  topWriteText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  // ── 에디터 (펼친 일기장) §11-4 ──
  editorSafe: { flex: 1, backgroundColor: Journal.pageDeep },
  editorContent: { padding: 20 },
  // Fix 9: flexGrow로 RuledPaper(flex:1)가 남은 높이를 모두 채우게 함
  editorContentFill: { flexGrow: 1, padding: 20 },

  // 괘선 종이 (시안 §paper) — 글+첨부가 한 장의 괘선 위
  paper: {
    position: 'relative',
    backgroundColor: Journal.surface,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 224,
  },
  // 괘선 종이가 헤더~툴바 사이 전체 높이를 채움 (Fix 9)
  paperFill: {
    flex: 1,
    position: 'relative',
    backgroundColor: Journal.surface,
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 224,
  },
  ruleLayer: { ...StyleSheet.absoluteFillObject },
  ruleLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Journal.rule,
  },
  // 콘텐츠 패딩: 상단 14px → 첫 줄 글이 첫 괘선(32px) 위에 앉도록
  paperContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  // 첨부 미리보기 묶음 — 괘선 위에 그냥 얹힘
  attBlock: { marginTop: 14, gap: 12 },

  editorInput: {
    fontFamily: SERIF,
    fontSize: 16,
    lineHeight: RULE_SPACING, // 괘선 간격과 동일 → 글이 줄에 맞음
    color: Journal.ink,
    minHeight: RULE_SPACING * 5,
    padding: 0,
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

  // 상단 우측 저장 버튼 (에디터)
  topSaveBtn: { paddingHorizontal: 8, paddingVertical: 8, minHeight: 40, justifyContent: 'center' },
  topSaveText: { fontSize: 16, fontWeight: '700', color: Journal.accent },

  // 도구막대 (키보드 위 고정)
  toolbarBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Journal.rule,
    backgroundColor: Journal.page,
  },
  tool: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 48,
    borderRadius: 10,
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { fontSize: 15, fontWeight: '600', color: Journal.inkSoft },
  toolActive: { backgroundColor: Journal.accent, borderColor: Journal.accent },
  toolTextActive: { color: '#FAF5E9' },

  // 음성 첨부 pill (에디터, 시안)
  attAudio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    alignSelf: 'flex-start',
    backgroundColor: Journal.surface,
    borderWidth: 1,
    borderColor: Journal.rule,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attAudioPlay: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Journal.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attAudioLabel: { fontSize: 13, fontWeight: '500', color: Journal.inkSoft },
  attAudioAction: { fontSize: 13, fontWeight: '600', color: Journal.accent },

  // 영상 첨부 프레임 (에디터, 시안)
  attVidWrap: { width: 120, height: 74, alignSelf: 'flex-start' },
  attVid: {
    width: 120,
    height: 74,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Journal.rule,
    backgroundColor: Journal.ink,
  },
  attVidPlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    margin: 'auto',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attVidX: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Journal.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
