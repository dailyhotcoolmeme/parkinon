import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { uploadSound } from '../../lib/r2Upload';
import { provisionForUser } from '../../lib/alarmSound';
import i18n from '../../i18n';
import { useTranslation } from 'react-i18next';

const MAX_DURATION_MS = 5000; // 최대 5초

type Phase = 'idle' | 'ready' | 'recording' | 'recorded';

export function RecordSoundScreen() {
  const { t } = useTranslation();
  // 모듈 스코프 상수(i18n.t 1회 평가)로 두면 앱 부팅 로케일에 영구 고정돼 언어 전환 후에도
  // 안 바뀌는 버그가 있었다(AlarmSoundSettingsScreen과 동일 패턴, 오너 발견 2026-07-06).
  const defaultLabel = t('recordSound.defaultLabel');
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const dialog = useDialog();

  // 수정 모드: editSoundId 가 오면 기존 custom_sounds 행을 UPDATE (새 행 INSERT 아님)
  const editSoundId: string | undefined = route.params?.editSoundId;
  const editLabel: string | undefined = route.params?.editLabel;
  const isEditMode = !!editSoundId;

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0); // 녹음 경과 시간(표시용)
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDurationMs, setRecordedDurationMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [label, setLabel] = useState(isEditMode ? (editLabel ?? '') : '');
  const [saving, setSaving] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false); // 녹음 팝업 표시 여부

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
          title: t('recordSound.micPermTitle'),
          message: t('recordSound.micPermMsg'),
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
      setPhase('ready');
      dialog.alert({
        title: t('recordSound.recordStartFailTitle'),
        message: t('recordSound.genericRetryMsg'),
      });
    }
  };

  // ── 녹음 중지 ──────────────────────────────────────────────
  const handleStopRecording = useCallback(async () => {
    clearTimers();
    const recording = recordingRef.current;
    if (!recording) {
      setPhase('ready');
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
        setPhase('ready');
        dialog.alert({
          title: t('recordSound.recordFailTitle'),
          message: t('recordSound.recordFailMsg'),
        });
      }
    } catch (e) {
      recordingRef.current = null;
      setPhase('ready');
      dialog.alert({
        title: t('recordSound.recordFailTitle'),
        message: t('recordSound.recordFailMsg'),
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
        title: t('recordSound.playFailTitle'),
        message: t('recordSound.playFailMsg'),
      });
    }
  };

  // ── 다시 녹음(팝업 안에서 준비 상태로 되돌림) ──────────────────
  const handleReRecord = async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsPlaying(false);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setElapsedMs(0);
    setPhase('ready');
  };

  // ── 녹음 팝업 열기/닫기 ────────────────────────────────────
  // 열 때는 바로 녹음하지 않고 'ready'(녹음 시작 버튼 노출) 상태로.
  const openRecorder = () => {
    setIsPlaying(false);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setElapsedMs(0);
    setPhase('ready');
    setRecordOpen(true);
  };
  const closeRecorder = async () => {
    clearTimers();
    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setIsPlaying(false);
    setRecordedUri(null);
    setRecordedDurationMs(0);
    setElapsedMs(0);
    setPhase('idle');
    setRecordOpen(false);
  };

  // ── 저장 ──────────────────────────────────────────────────
  // 신규 등록: custom_sounds INSERT.
  // 수정 모드(isEditMode): 같은 id 행을 UPDATE (RPC). 새로 녹음했으면 소리 교체, 아니면 이름만 변경.
  const handleSave = async () => {
    if (!user) return;
    // 수정 모드는 녹음 없이 이름만 변경 가능. 신규는 녹음 필수.
    if (!isEditMode && !recordedUri) return;

    if (!user.patient_group_id) {
      dialog.alert({
        title: t('recordSound.linkFamilyRequiredTitle'),
        message: t('recordSound.linkFamilyRequiredMsg'),
      });
      return;
    }

    // 중앙 오버레이가 깔끔히 보이도록 녹음 팝업을 먼저 닫는다(저장 진행은 그대로).
    setRecordOpen(false);
    setSaving(true);
    try {
      // 재생 중이면 정지
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setIsPlaying(false);
      }

      const finalLabel = label.trim() || defaultLabel;

      if (isEditMode && editSoundId) {
        // ── 수정: 기존 행 UPDATE (id 유지 → 참조 무결성 보존) ──
        let newUrl: string | null = null;
        let newKey: string | null = null;
        let newDuration: number | null = null;
        const soundReplaced = !!recordedUri;

        if (soundReplaced) {
          // 새로 녹음함 → 신규와 동일 경로로 업로드
          const result = await uploadSound(recordedUri!, user.id, 'audio/m4a');
          newUrl = result.url;
          newKey = result.key;
          newDuration = recordedDurationMs;
        }

        const { data: ok, error } = await (supabase.rpc as any)('update_custom_sound', {
          p_sound_id: editSoundId,
          p_label: finalLabel,
          p_public_url: newUrl, // null이면 소리 그대로(이름만 변경)
          p_r2_key_src: newKey,
          p_duration_ms: newDuration,
        });
        if (error) throw new Error(error.message);
        if (!ok) {
          dialog.alert({
            title: t('recordSound.editForbiddenTitle'),
            message: t('recordSound.editForbiddenMsg'),
          });
          return;
        }

        // 소리가 바뀌었으면 기기 알림 채널을 새 소리로 갱신
        if (soundReplaced) {
          await provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
        }

        await dialog.alert({
          title: t('recordSound.editDoneTitle'),
          message: t('recordSound.editDoneMsg'),
        });
        // 목록 화면이 즉시 반영하도록 변경분 전달 (복제 지연으로 재조회가 옛 값일 수 있어 대비)
        navigation.navigate('AlarmSoundSettings', {
          updatedSound: {
            id: editSoundId,
            label: finalLabel,
            public_url: newUrl, // null이면 목록이 기존 소리 유지
            duration_ms: newDuration,
          },
        });
        return;
      }

      // ── 신규 등록: INSERT (기존 흐름 그대로) ──
      const result = await uploadSound(recordedUri!, user.id, 'audio/m4a');
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
        title: t('recordSound.saveDoneTitle'),
        message: t('recordSound.saveDoneMsg'),
      });
      navigation.goBack();
    } catch (e: any) {
      dialog.alert({
        title: t('recordSound.saveFailTitle'),
        message:
          e?.message === 'UPLOAD_TIMEOUT'
            ? t('recordSound.slowInternetMsg')
            : t('recordSound.genericRetryMsg'),
      });
    } finally {
      setSaving(false);
    }
  };

  // 남은 시간(초) — 녹음 중 표시
  const remainSec = Math.max(0, Math.ceil((MAX_DURATION_MS - elapsedMs) / 1000));
  const elapsedSecText = (elapsedMs / 1000).toFixed(1);
  const recordedSecText = (recordedDurationMs / 1000).toFixed(1);

  // 활용 예시 카드 — 신규 등록은 상단, 수정 모드는 하단에 재사용
  const usageCard = (
    <View style={styles.usageBox}>
      <Text style={styles.usageTitle}>{t('recordSound.usageTitle')}</Text>
      <View style={styles.usageRow}>
        <Text style={styles.usageEmoji}>👶</Text>
        <Text style={styles.usageText}>
          {t('recordSound.usageGrandchild')}
        </Text>
      </View>
      <View style={styles.usageRow}>
        <Text style={styles.usageEmoji}>💕</Text>
        <Text style={styles.usageText}>
          {t('recordSound.usageChild')}
        </Text>
      </View>
      <View style={styles.usageRow}>
        <Text style={styles.usageEmoji}>🎵</Text>
        <Text style={styles.usageText}>{t('recordSound.usageSong')}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* SafeAreaView edges는 위에서 처리 — 하단은 탭바가 인셋을 잡으므로 제외 */}
      <TopBar title={isEditMode ? t('recordSound.headerEdit') : t('recordSound.headerNew')} showBack />

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
        {/* 상단: 수정 모드는 안내 문구, 신규 등록은 활용 예시 카드(하단 중복 제거) */}
        {isEditMode ? (
          <View style={styles.guideBox}>
            <Text style={styles.guideTitle}>{t('recordSound.guideEditTitle')}</Text>
            <Text style={styles.guideText}>
              {t('recordSound.guideEditText')}
            </Text>
          </View>
        ) : (
          usageCard
        )}

        {/* 상태 표시 영역 — 녹음은 팝업에서 진행, 페이지엔 마이크만 */}
        <View style={styles.statusArea}>
          <View style={styles.idleMicCircle}>
            <Ionicons name="mic" size={48} color={Colors.primary} />
          </View>
          {!isEditMode && (
            <Text style={styles.idleText}>{t('recordSound.idleHint')}</Text>
          )}
        </View>

        {/* 하단 버튼 영역 — 녹음/저장은 팝업에서, 페이지는 진입 버튼만 */}
        <View style={styles.buttonArea}>
          {isEditMode ? (
            // 수정 모드: 다시 녹음(소리 변경) · 이름만 변경 — 두 줄짜리 박스 한 줄
            <View style={styles.editBtnRow}>
              <TouchableOpacity
                style={[styles.bigButton, styles.recordButton, styles.editBtnHalf]}
                onPress={openRecorder}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={styles.bigButtonText}>{t('recordSound.reRecord')}</Text>
                <Text style={styles.bigButtonSub}>{t('recordSound.soundChange')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.bigButton, styles.saveButton, styles.editBtnHalf, saving && styles.disabledButton]}
                onPress={() => setShowNameModal(true)}
                activeOpacity={0.85}
                disabled={saving}
              >
                <Text style={styles.bigButtonText}>{t('recordSound.nameOnlyChange')}</Text>
                <Text style={styles.bigButtonSub}>
                  {t('recordSound.currentNameLabel', { name: label.trim() || defaultLabel })}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.bigButton, styles.recordButton]}
              onPress={openRecorder}
              activeOpacity={0.85}
              disabled={saving}
            >
              <Text style={styles.bigButtonText}>{t('recordSound.startRecording')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 활용 예시 — 수정 모드에선 하단에 안내(신규는 상단에 이미 배치) */}
        {isEditMode && phase === 'idle' && usageCard}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* 녹음 팝업 — 준비('녹음 시작') → 녹음/중지 → 들어보기·저장까지 한 팝업에서 */}
      <Modal
        visible={recordOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeRecorder}
      >
        <View style={styles.recOverlay}>
          <View style={styles.recCard}>
            {phase === 'recording' ? (
              <>
                <Text style={styles.recordingDot}>{t('recordSound.recordingDot')}</Text>
                <Text style={styles.bigTimer}>{t('recordSound.secondsSuffix', { n: elapsedSecText })}</Text>
                <Text style={styles.remainText}>{t('recordSound.secondsLeft', { n: remainSec })}</Text>
                <TouchableOpacity
                  style={[styles.recBtnBase, styles.recBtnDanger, styles.recFullBtn]}
                  onPress={handleStopRecording}
                  activeOpacity={0.85}
                >
                  <Text style={styles.recBtnTextLight}>{t('recordSound.stop')}</Text>
                </TouchableOpacity>
              </>
            ) : phase === 'recorded' ? (
              <>
                <Text style={styles.doneText}>{t('recordSound.recordDoneText')}</Text>
                <Text style={styles.bigTimer}>{t('recordSound.secondsSuffix', { n: recordedSecText })}</Text>
                <Text style={styles.remainText}>{t('recordSound.listenAndSave')}</Text>
                <View style={styles.recBtnRow}>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnAccent, styles.recHalfBtn]}
                    onPress={handlePlayPreview}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    <Ionicons name="play" size={18} color="#FFFFFF" style={styles.recBtnIcon} />
                    <Text style={styles.recBtnTextLight}>{isPlaying ? t('recordSound.playingNow') : t('recordSound.listen')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnAccent, styles.recHalfBtn]}
                    onPress={handleReRecord}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    <Ionicons name="ellipse" size={15} color="#FFFFFF" style={styles.recBtnIcon} />
                    <Text style={styles.recBtnTextLight}>{t('recordSound.reRecord')}</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.recBtnRow}>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnGrey, styles.recHalfBtn]}
                    onPress={closeRecorder}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    <Text style={styles.recBtnTextDark}>{t('recordSound.close')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnPrimary, styles.recHalfBtn, saving && styles.disabledButton]}
                    onPress={() => {
                      if (!isEditMode) setLabel('');
                      setShowNameModal(true);
                    }}
                    activeOpacity={0.85}
                    disabled={saving}
                  >
                    <Text style={styles.recBtnTextLight}>{t('recordSound.saveBtn')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              // 'ready' — 바로 시작하지 않고 버튼을 눌러야 녹음 시작
              <>
                <Text style={styles.recTitle}>{t('recordSound.readyTitle')}</Text>
                <Text style={styles.recSub}>{t('recordSound.readySub')}</Text>
                <View style={styles.recMicCircle}>
                  <Ionicons name="mic" size={44} color={Colors.primary} />
                </View>
                <View style={styles.recBtnRow}>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnGrey, styles.recHalfBtn]}
                    onPress={closeRecorder}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.recBtnTextDark}>{t('recordSound.close')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recBtnBase, styles.recBtnPrimary, styles.recHalfBtn]}
                    onPress={handleStartRecording}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.recBtnTextLight}>{t('recordSound.startRecording')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

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
            <Text style={styles.modalTitle}>
              {isEditMode ? t('recordSound.nameModalEditTitle') : t('recordSound.nameModalNewTitle')}
            </Text>
            <Text style={styles.modalSub}>{t('recordSound.nameModalSub')}</Text>
            <TextInput
              style={styles.modalInput}
              value={label}
              onChangeText={setLabel}
              placeholder={t('recordSound.namePlaceholder')}
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
                <Text style={styles.modalCancelText}>{t('recordSound.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalSaveBtn]}
                onPress={() => { setShowNameModal(false); handleSave(); }}
                activeOpacity={0.85}
              >
                <Text style={styles.modalSaveText}>{t('recordSound.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <BrandProgressOverlay
        visible={saving}
        title={i18n.t('loading.saving')}
        minVisibleMs={500}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex1: { flex: 1 },
  scrollContent: {
    padding: 20,
    flexGrow: 1,
    paddingBottom: 16,
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
  modalCancelText: { fontSize: 18, fontWeight: '700', color: Colors.textSub },
  modalSaveBtn: { backgroundColor: Colors.primary },
  modalSaveText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // 안내
  guideBox: {
    backgroundColor: Colors.light,
    borderRadius: 16,
    padding: 20,
  },
  guideTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.dark,
    marginBottom: 8,
  },
  guideText: {
    fontSize: 18,
    lineHeight: 26,
    color: Colors.textSub,
    fontWeight: '400',
  },

  // 상태 영역
  statusArea: {
    flex: 1,
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  idleEmoji: {
    fontSize: 72,
  },
  idleMicCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleText: {
    fontSize: 17,
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

  // 버튼
  buttonArea: {
    gap: 12,
  },
  editBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  editBtnHalf: {
    flex: 1,
  },
  bigButton: {
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  bigButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  bigButtonSub: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
    textAlign: 'center',
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

  // 활용 예시 카드
  usageBox: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    marginTop: 18,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  usageTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  usageEmoji: {
    fontSize: 26,
    lineHeight: 30,
  },
  usageText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 23,
    color: Colors.textSub,
  },
  usageQuote: {
    color: Colors.dark,
    fontWeight: '600',
  },

  // 녹음 팝업
  recOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  recCard: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  recTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  recSub: {
    fontSize: 15,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 4,
  },
  recMicCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  recFullBtn: {
    alignSelf: 'stretch',
  },
  recBtnRow: {
    flexDirection: 'row',
    gap: 12,
    alignSelf: 'stretch',
  },
  recHalfBtn: {
    flex: 1,
  },
  recCancelBtn: {
    backgroundColor: '#F0F0F0',
  },
  recCancelText: {
    color: Colors.textSub,
  },
  // 팝업 버튼 — 색 3종(초록/빨강/연회색), 글자 2종(흰/검)만 사용
  recBtnBase: {
    minHeight: 54,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  recBtnPrimary: {
    backgroundColor: Colors.primary,
  },
  recBtnDanger: {
    backgroundColor: Colors.danger,
  },
  recBtnGrey: {
    backgroundColor: '#F0F0F0',
  },
  recBtnAccent: {
    backgroundColor: Colors.accent,
  },
  recBtnIcon: {
    marginRight: 6,
  },
  recBtnTextLight: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  recBtnTextDark: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
});
