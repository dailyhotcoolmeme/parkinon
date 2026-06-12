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
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Video as VideoCompressor } from 'react-native-compressor';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { useDiary, DiaryEntry, AutoSummary } from '../../hooks/useDiary';
import { uploadPhoto, uploadVideo, uploadSound } from '../../lib/r2Upload';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
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

// '6/12 (목)' 형식 라벨
function formatDateLabel(dateStr: string): string {
  const dt = dateStrToDate(dateStr);
  return `${dt.getMonth() + 1}/${dt.getDate()} (${WEEKDAYS[dt.getDay()]})`;
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="일기" showBack />

      {/* 날짜 네비게이션 */}
      <View style={styles.dateNav}>
        <TouchableOpacity
          style={styles.navArrowBtn}
          onPress={() => setDateStr(shiftDate(dateStr, -1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={28} color={Colors.text} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.dateCenter} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
          <Text style={styles.dateLabel}>{formatDateLabel(dateStr)}</Text>
          {isToday && <Text style={styles.todayBadge}>오늘</Text>}
          <Ionicons name="calendar-outline" size={22} color={Colors.textSub} style={{ marginLeft: 8 }} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navArrowBtn, !canGoNext && styles.navArrowDisabled]}
          onPress={() => canGoNext && setDateStr(shiftDate(dateStr, 1))}
          disabled={!canGoNext}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-forward" size={28} color={canGoNext ? Colors.text : Colors.border} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 오늘의 기록(자동) ── */}
          <SectionTitle text="오늘의 기록" sub="자동으로 모인 기록이에요" />
          <AutoSummaryCard summary={autoSummary} />

          {/* ── 한마디 ── */}
          <SectionTitle text="한마디" sub="환자와 보호자가 함께 적어요" />

          {entries.length === 0 && (
            <View style={styles.emptyEntryCard}>
              <Text style={styles.emptyEntryText}>아직 적은 한마디가 없어요.</Text>
            </View>
          )}

          {entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} isMine={entry.author_id === user?.id} />
          ))}

          {/* 내가 안 썼으면 쓰기 진입 */}
          {!myEntry && (
            <TouchableOpacity style={styles.writeEntryCard} onPress={() => setShowEditor(true)} activeOpacity={0.85}>
              <Ionicons name="create-outline" size={26} color={Colors.primary} />
              <Text style={styles.writeEntryText}>오늘 일기 쓰기</Text>
            </TouchableOpacity>
          )}

          {/* 내가 썼으면 수정 버튼 */}
          {myEntry && (
            <TouchableOpacity style={styles.editEntryBtn} onPress={() => setShowEditor(true)} activeOpacity={0.85}>
              <Ionicons name="pencil-outline" size={22} color={Colors.primary} />
              <Text style={styles.editEntryText}>내 한마디 수정하기</Text>
            </TouchableOpacity>
          )}

          {/* 웹 추세 보기 */}
          <WebTrendButton dialog={dialog} />

          <View style={{ height: 24 }} />
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

// ─── 섹션 제목 ────────────────────────────────────────────────────────────────

function SectionTitle({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{text}</Text>
      {sub && <Text style={styles.sectionSub}>{sub}</Text>}
    </View>
  );
}

// ─── 자동 수집 카드 ───────────────────────────────────────────────────────────

function AutoSummaryCard({ summary }: { summary: AutoSummary | null }) {
  if (!summary) return null;
  const hasAny =
    summary.med.count > 0 ||
    summary.onOff.count > 0 ||
    summary.exercise.length > 0 ||
    summary.media.length > 0;

  if (!hasAny) {
    return (
      <View style={styles.autoCard}>
        <Text style={styles.autoEmptyText}>이 날은 자동으로 모인 기록이 없어요.</Text>
      </View>
    );
  }

  return (
    <View style={styles.autoCard}>
      {summary.med.count > 0 && (
        <View style={styles.autoRow}>
          <Text style={styles.autoEmoji}>💊</Text>
          <Text style={styles.autoText}>
            약 복용 {summary.med.count}회
            {summary.med.times.length > 0 ? ` · ${summary.med.times.join(', ')}` : ''}
          </Text>
        </View>
      )}
      {summary.onOff.count > 0 && (
        <View style={styles.autoRow}>
          <Text style={styles.autoEmoji}>😊</Text>
          <Text style={styles.autoText}>
            약효 추적 {summary.onOff.count}건
            {summary.onOff.representativeScore != null ? ` (${summary.onOff.representativeScore}점)` : ''}
          </Text>
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
      {summary.media.length > 0 && (
        <View style={styles.autoMediaWrap}>
          <Text style={styles.autoEmoji}>📷</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.thumbRow}>
              {summary.media.map((m) => (
                <View key={m.id} style={styles.autoThumb}>
                  {m.mediaType === 'photo' ? (
                    <Image source={{ uri: m.url }} style={styles.autoThumbImg} />
                  ) : (
                    <View style={[styles.autoThumbImg, styles.videoThumb]}>
                      <Ionicons name="videocam" size={26} color="#fff" />
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── 한마디 카드 ──────────────────────────────────────────────────────────────

function EntryCard({ entry, isMine }: { entry: DiaryEntry; isMine: boolean }) {
  const dialog = useDialog();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

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
    <View style={[styles.entryCard, isMine && styles.entryCardMine]}>
      <View style={styles.entryHeader}>
        <Text style={styles.entryAuthor}>
          {roleIcon} {entry.author_name}
        </Text>
        <Text style={styles.entryRole}>{roleLabel}</Text>
      </View>

      {!!entry.text && <Text style={styles.entryText}>{entry.text}</Text>}

      {/* 첨부: 음성 / 사진 / 영상 */}
      {(entry.audio_url || entry.photo_urls.length > 0 || entry.video_url) && (
        <View style={styles.attachWrap}>
          {entry.audio_url && (
            <TouchableOpacity style={styles.audioBtn} onPress={handlePlayAudio} activeOpacity={0.8}>
              <Ionicons name={playing ? 'stop-circle' : 'play-circle'} size={26} color={Colors.primary} />
              <Text style={styles.audioBtnText}>{playing ? '음성 멈춤' : '음성 듣기'}</Text>
            </TouchableOpacity>
          )}
          {(entry.photo_urls.length > 0 || entry.video_url) && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.thumbRow}>
                {entry.photo_urls.map((url, i) => (
                  <Image key={`p-${i}`} source={{ uri: url }} style={styles.entryThumb} />
                ))}
                {entry.video_url && (
                  <View style={[styles.entryThumb, styles.videoThumb]}>
                    <Ionicons name="videocam" size={26} color="#fff" />
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

// ─── 웹 추세 보기 버튼 ────────────────────────────────────────────────────────

function WebTrendButton({ dialog }: { dialog: ReturnType<typeof useDialog> }) {
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
    <TouchableOpacity style={styles.webBtn} onPress={handleWebOpen} activeOpacity={0.85} disabled={webLoading}>
      {webLoading ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <>
          <Ionicons name="bar-chart-outline" size={24} color={Colors.primary} />
          <Text style={styles.webBtnText}>웹으로 추세 보기</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── 작성/수정 모달 ───────────────────────────────────────────────────────────

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
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
            <Text style={styles.editorGuide}>
              오늘 하루를 한마디로 남겨보세요. 글, 음성, 사진, 영상을 함께 넣을 수 있어요.
            </Text>

            {/* 글 입력 */}
            <Text style={styles.editorLabel}>글</Text>
            <TextInput
              style={styles.editorInput}
              value={text}
              onChangeText={setText}
              placeholder="예: 오늘은 컨디션이 좋았어요."
              placeholderTextColor={Colors.textHint}
              multiline
              textAlignVertical="top"
            />

            {/* 음성 첨부 */}
            <Text style={styles.editorLabel}>음성</Text>
            {hasAudio ? (
              <View style={styles.attachedRow}>
                <Ionicons name="mic" size={24} color={Colors.primary} />
                <Text style={styles.attachedText}>음성이 첨부되었어요</Text>
                <TouchableOpacity onPress={handleRemoveAudio} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>빼기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.attachBtn, recording && styles.attachBtnActive]}
                onPress={handleToggleRecord}
                activeOpacity={0.85}
              >
                <Ionicons name={recording ? 'stop-circle' : 'mic-outline'} size={24} color={recording ? '#fff' : Colors.primary} />
                <Text style={[styles.attachBtnText, recording && styles.attachBtnTextActive]}>
                  {recording ? '녹음 멈추기' : '음성 녹음하기'}
                </Text>
              </TouchableOpacity>
            )}

            {/* 사진 첨부 */}
            <Text style={styles.editorLabel}>사진</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.thumbRow}>
                {photoUrls.map((url, i) => (
                  <View key={`ep-${i}`} style={styles.editorThumbWrap}>
                    <Image source={{ uri: url }} style={styles.editorThumb} />
                    <TouchableOpacity style={styles.thumbRemove} onPress={() => handleRemovePhoto(i, true)}>
                      <Ionicons name="close-circle" size={24} color="#F44336" />
                    </TouchableOpacity>
                  </View>
                ))}
                {newPhotoUris.map((uri, i) => (
                  <View key={`np-${i}`} style={styles.editorThumbWrap}>
                    <Image source={{ uri }} style={styles.editorThumb} />
                    <TouchableOpacity style={styles.thumbRemove} onPress={() => handleRemovePhoto(i, false)}>
                      <Ionicons name="close-circle" size={24} color="#F44336" />
                    </TouchableOpacity>
                  </View>
                ))}
                {photoUrls.length + newPhotoUris.length < 5 && (
                  <TouchableOpacity style={styles.addThumb} onPress={handleAddPhoto} activeOpacity={0.8}>
                    <Ionicons name="add" size={32} color={Colors.textSub} />
                    <Text style={styles.addThumbText}>사진</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>

            {/* 영상 첨부 */}
            <Text style={styles.editorLabel}>영상 (최대 2분)</Text>
            {hasVideo ? (
              <View style={styles.attachedRow}>
                <Ionicons name="videocam" size={24} color={Colors.primary} />
                <Text style={styles.attachedText}>영상이 첨부되었어요</Text>
                <TouchableOpacity onPress={handleRemoveVideo} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>빼기</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.videoBtnRow}>
                <TouchableOpacity style={styles.attachBtn} onPress={handleRecordVideo} activeOpacity={0.85}>
                  <Ionicons name="camera-outline" size={24} color={Colors.primary} />
                  <Text style={styles.attachBtnText}>촬영하기</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={handlePickVideo} activeOpacity={0.85}>
                  <Ionicons name="images-outline" size={24} color={Colors.primary} />
                  <Text style={styles.attachBtnText}>갤러리</Text>
                </TouchableOpacity>
              </View>
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
  safeArea: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // 날짜 네비
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  navArrowBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  navArrowDisabled: { opacity: 0.4 },
  dateCenter: { flexDirection: 'row', alignItems: 'center' },
  dateLabel: { fontSize: 22, fontWeight: '800', color: Colors.text },
  todayBadge: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    backgroundColor: Colors.light,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },

  // 섹션 제목
  sectionTitleWrap: { marginTop: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  sectionSub: { fontSize: 15, color: Colors.textSub, marginTop: 2 },

  // 자동 카드
  autoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  autoEmoji: { fontSize: 22 },
  autoText: { fontSize: 18, color: Colors.text, fontWeight: '600', flex: 1 },
  autoEmptyText: { fontSize: 17, color: Colors.textSub },
  autoMediaWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  thumbRow: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  autoThumb: { width: 64, height: 64, borderRadius: 10, overflow: 'hidden' },
  autoThumbImg: { width: 64, height: 64, borderRadius: 10, backgroundColor: '#1A1A1A' },
  videoThumb: { alignItems: 'center', justifyContent: 'center' },

  // 한마디 카드
  emptyEntryCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyEntryText: { fontSize: 17, color: Colors.textSub },
  entryCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  entryCardMine: { borderWidth: 2, borderColor: Colors.primary },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  entryAuthor: { fontSize: 19, fontWeight: '800', color: Colors.text },
  entryRole: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSub,
    backgroundColor: Colors.background,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  entryText: { fontSize: 18, color: Colors.text, lineHeight: 26, marginBottom: 4 },
  attachWrap: { marginTop: 8, gap: 10 },
  audioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.light,
  },
  audioBtnText: { fontSize: 17, fontWeight: '700', color: Colors.primary },
  entryThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#1A1A1A' },

  // 쓰기/수정 진입
  writeEntryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    minHeight: 64,
    marginBottom: 12,
  },
  writeEntryText: { fontSize: 19, fontWeight: '800', color: Colors.primary },
  editEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    marginBottom: 12,
  },
  editEntryText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  // 웹 추세
  webBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    minHeight: 60,
    marginTop: 4,
  },
  webBtnText: { fontSize: 18, fontWeight: '800', color: Colors.primary },

  // 에디터
  editorContent: { padding: 16 },
  editorGuide: { fontSize: 16, color: Colors.textSub, lineHeight: 24, marginBottom: 16 },
  editorLabel: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 16, marginBottom: 8 },
  editorInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 18,
    color: Colors.text,
    minHeight: 110,
    backgroundColor: Colors.white,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    flex: 1,
  },
  attachBtnActive: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  attachBtnText: { fontSize: 17, fontWeight: '700', color: Colors.primary },
  attachBtnTextActive: { color: '#fff' },
  videoBtnRow: { flexDirection: 'row', gap: 12 },
  attachedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.light,
    paddingHorizontal: 16,
  },
  attachedText: { fontSize: 17, fontWeight: '700', color: Colors.text, flex: 1 },
  removeBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  removeBtnText: { fontSize: 16, fontWeight: '700', color: Colors.danger },
  editorThumbWrap: { position: 'relative' },
  editorThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: '#1A1A1A' },
  thumbRemove: { position: 'absolute', top: -8, right: -8, backgroundColor: '#fff', borderRadius: 12 },
  addThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addThumbText: { fontSize: 14, color: Colors.textSub, fontWeight: '600' },

  editorBottom: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
  saveBtn: {
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 20, fontWeight: '800', color: '#fff' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
