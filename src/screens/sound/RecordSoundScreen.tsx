import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { uploadSound } from '../../lib/r2Upload';

const MAX_DURATION_MS = 5000; // 최대 5초
const DEFAULT_LABEL = '내 녹음';

type Phase = 'idle' | 'recording' | 'recorded';

export function RecordSoundScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const dialog = useDialog();

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0); // 녹음 경과 시간(표시용)
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordStartRef = useRef<number>(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const labelYRef = useRef<number>(0);

  // 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
      // 진행 중인 녹음/재생 정리
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const clearTimers = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
  };

  // ── 녹음 시작 ──────────────────────────────────────────────
  const handleStartRecording = async () => {
    try {
      // 마이크 권한 요청
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        dialog.alert({
          title: '마이크 권한이 필요해요',
          message:
            '녹음을 하려면 마이크 사용을 허용해 주세요.\n휴대폰 설정에서 마이크 권한을 켜 주세요.',
        });
        return;
      }

      // iOS 무음 스위치에서도 녹음·재생되도록 설정
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // 이전 재생음 정리
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      setIsPlaying(false);
      setRecordedUri(null);
      setRecordedDurationMs(0);

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      await recording.startAsync();
      recordingRef.current = recording;
      recordStartRef.current = Date.now();
      setElapsedMs(0);
      setPhase('recording');

      // 경과 시간 표시 (100ms 간격)
      tickRef.current = setInterval(() => {
        const e = Date.now() - recordStartRef.current;
        setElapsedMs(Math.min(e, MAX_DURATION_MS));
      }, 100);

      // 5초 자동 중지
      autoStopRef.current = setTimeout(() => {
        handleStopRecording();
      }, MAX_DURATION_MS);
    } catch (e: any) {
      clearTimers();
      setPhase('idle');
      dialog.alert({
        title: '녹음을 시작할 수 없어요',
        message: '잠시 후 다시 시도해 주세요.',
      });
    }
  };

  // ── 녹음 중지 ──────────────────────────────────────────────
  const handleStopRecording = useCallback(async () => {
    clearTimers();
    const recording = recordingRef.current;
    if (!recording) {
      setPhase('idle');
      return;
    }
    try {
      const elapsed = Math.min(
        Date.now() - recordStartRef.current,
        MAX_DURATION_MS,
      );
      let status: any = null;
      try {
        status = await recording.getStatusAsync();
      } catch (_) {}
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;

      // 녹음 종료 후에는 무음 모드 재생만 유지
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      const durationMs =
        status?.durationMillis && status.durationMillis > 0
          ? Math.min(status.durationMillis, MAX_DURATION_MS)
          : elapsed;

      if (uri) {
        setRecordedUri(uri);
        setRecordedDurationMs(durationMs);
        setPhase('recorded');
      } else {
        setPhase('idle');
        dialog.alert({
          title: '녹음에 실패했어요',
          message: '다시 한 번 녹음해 주세요.',
        });
      }
    } catch (e) {
      recordingRef.current = null;
      setPhase('idle');
      dialog.alert({
        title: '녹음에 실패했어요',
        message: '다시 한 번 녹음해 주세요.',
      });
    }
  }, [dialog]);

  // ── 미리듣기 ──────────────────────────────────────────────
  const handlePlayPreview = async () => {
    if (!recordedUri) return;
    try {
      // 재생 중이면 정지
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: recordedUri },
        { shouldPlay: true },
      );
      soundRef.current = sound;
      setIsPlaying(true);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          setIsPlaying(false);
          sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
        }
      });
    } catch (e) {
      setIsPlaying(false);
      dialog.alert({
        title: '재생할 수 없어요',
        message: '다시 시도해 주세요.',
      });
    }
  };

  // ── 다시 녹음 ──────────────────────────────────────────────
  const handleReRecord = async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsPlaying(false);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setElapsedMs(0);
    setPhase('idle');
  };

  // ── 저장 ──────────────────────────────────────────────────
  const handleSave = async () => {
    if (!recordedUri || !user) return;

    if (!user.patient_group_id) {
      dialog.alert({
        title: '가족 연동이 필요해요',
        message:
          '알림음을 저장하려면 먼저 가족 연동을 해 주세요.\n메뉴에서 가족 연동을 진행할 수 있어요.',
      });
      return;
    }

    setSaving(true);
    try {
      // 재생 중이면 정지
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setIsPlaying(false);
      }

      const result = await uploadSound(recordedUri, user.id, 'audio/m4a');

      const finalLabel = label.trim() || DEFAULT_LABEL;
      const { error } = await supabase.from('custom_sounds' as any).insert({
        group_id: user.patient_group_id,
        recorded_by: user.id,
        label: finalLabel,
        r2_key_src: result.key,
        public_url: result.url,
        duration_ms: recordedDurationMs,
      });

      if (error) {
        throw new Error(error.message);
      }

      await dialog.alert({
        title: '저장 완료',
        message: '알림음이 저장되었어요.',
      });
      navigation.goBack();
    } catch (e: any) {
      dialog.alert({
        title: '저장에 실패했어요',
        message:
          e?.message === 'UPLOAD_TIMEOUT'
            ? '인터넷 연결이 느려요.\n와이파이 연결 후 다시 시도해 주세요.'
            : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSaving(false);
    }
  };

  // 남은 시간(초) — 녹음 중 표시
  const remainSec = Math.max(0, Math.ceil((MAX_DURATION_MS - elapsedMs) / 1000));
  const elapsedSecText = (elapsedMs / 1000).toFixed(1);
  const recordedSecText = (recordedDurationMs / 1000).toFixed(1);

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="알림음 녹음" showBack />

      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        ref={scrollRef}
        style={styles.flex1}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 안내 문구 */}
        <View style={styles.guideBox}>
          <Text style={styles.guideTitle}>5초 이내로 녹음해 주세요</Text>
          <Text style={styles.guideText}>
            예: "엄마~ 약 드세요~"{'\n'}
            녹음 버튼을 누르고 또박또박 말해 주세요.
          </Text>
        </View>

        {/* 상태 표시 영역 */}
        <View style={styles.statusArea}>
          {phase === 'recording' ? (
            <>
              <Text style={styles.recordingDot}>● 녹음 중</Text>
              <Text style={styles.bigTimer}>{elapsedSecText}초</Text>
              <Text style={styles.remainText}>{remainSec}초 남았어요</Text>
            </>
          ) : phase === 'recorded' ? (
            <>
              <Text style={styles.doneText}>녹음 완료</Text>
              <Text style={styles.bigTimer}>{recordedSecText}초</Text>
              <Text style={styles.remainText}>들어보고 저장하세요</Text>
            </>
          ) : (
            <>
              <Text style={styles.idleEmoji}>🎤</Text>
              <Text style={styles.idleText}>아래 버튼을 눌러 녹음을 시작하세요</Text>
            </>
          )}
        </View>

        {/* 하단 버튼 영역 */}
        <View style={styles.buttonArea}>
          {phase === 'idle' && (
            <TouchableOpacity
              style={[styles.bigButton, styles.recordButton]}
              onPress={handleStartRecording}
              activeOpacity={0.85}
            >
              <Text style={styles.bigButtonText}>● 녹음 시작</Text>
            </TouchableOpacity>
          )}

          {phase === 'recording' && (
            <TouchableOpacity
              style={[styles.bigButton, styles.stopButton]}
              onPress={handleStopRecording}
              activeOpacity={0.85}
            >
              <Text style={styles.bigButtonText}>■ 중지</Text>
            </TouchableOpacity>
          )}

          {phase === 'recorded' && (
            <>
              <TouchableOpacity
                style={[styles.bigButton, styles.playButton]}
                onPress={handlePlayPreview}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={styles.bigButtonText}>
                  {isPlaying ? '▶ 재생 중...' : '▶ 들어보기'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bigButton, styles.saveButton, saving && styles.disabledButton]}
                onPress={() => { setLabel(''); setShowNameModal(true); }}
                activeOpacity={0.85}
                disabled={saving}
              >
                {saving ? (
                  <View style={styles.savingRow}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.bigButtonText}>저장 중...</Text>
                  </View>
                ) : (
                  <Text style={styles.bigButtonText}>저장하기</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bigButton, styles.reRecordButton]}
                onPress={handleReRecord}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={[styles.bigButtonText, styles.reRecordText]}>
                  다시 녹음
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* 이름 입력 팝업 — 저장 시 가운데 모달로 입력(키보드 위로 뜸) */}
      <Modal
        visible={showNameModal}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowNameModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>알림음 이름</Text>
            <Text style={styles.modalSub}>나중에 알아보기 쉽게 이름을 붙여주세요.</Text>
            <TextInput
              style={styles.modalInput}
              value={label}
              onChangeText={setLabel}
              placeholder="예: 딸이 녹음"
              placeholderTextColor={Colors.textHint}
              maxLength={20}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { setShowNameModal(false); handleSave(); }}
            />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setShowNameModal(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={() => { setShowNameModal(false); handleSave(); }}
                activeOpacity={0.85}
              >
                <Text style={styles.modalSaveText}>저장</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  flex1: { flex: 1 },
  scrollContent: {
    padding: 20,
    flexGrow: 1,
    paddingBottom: 48,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  modalSub: { fontSize: 15, color: Colors.textSub, marginBottom: 16 },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: Colors.text,
    marginBottom: 20,
  },
  modalBtnRow: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modalCancelBtn: { backgroundColor: '#F0F0F0' },
  modalCancelText: { fontSize: 17, fontWeight: '700', color: Colors.textSub },
  modalSaveBtn: { backgroundColor: Colors.primary },
  modalSaveText: { fontSize: 17, fontWeight: '700', color: Colors.white },

  // 안내
  guideBox: {
    backgroundColor: Colors.light,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  guideTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark,
    marginBottom: 8,
  },
  guideText: {
    fontSize: 18,
    lineHeight: 26,
    color: Colors.text,
    fontWeight: '500',
  },

  // 상태 영역
  statusArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  idleEmoji: {
    fontSize: 72,
  },
  idleText: {
    fontSize: 19,
    color: Colors.textSub,
    fontWeight: '600',
    textAlign: 'center',
  },
  recordingDot: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.danger,
  },
  doneText: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.primary,
  },
  bigTimer: {
    fontSize: 64,
    fontWeight: '900',
    color: Colors.text,
  },
  remainText: {
    fontSize: 19,
    color: Colors.textSub,
    fontWeight: '600',
  },

  // 라벨 입력
  labelBox: {
    marginBottom: 16,
  },
  labelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  labelInput: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    color: Colors.text,
  },

  // 버튼
  buttonArea: {
    gap: 12,
  },
  bigButton: {
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  bigButtonText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  recordButton: {
    backgroundColor: Colors.danger,
  },
  stopButton: {
    backgroundColor: '#333333',
  },
  playButton: {
    backgroundColor: Colors.accent,
  },
  saveButton: {
    backgroundColor: Colors.primary,
  },
  disabledButton: {
    opacity: 0.6,
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reRecordButton: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.textSub,
  },
  reRecordText: {
    color: Colors.textSub,
  },
});
