import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { resolvePlaybackUrl } from '../../lib/r2Get';
import { useDialog } from '../../context/DialogContext';
import { navigateTo } from '../../navigation/navigationRef';
import { useTranslation } from 'react-i18next';

export interface AlarmSoundOption {
  id: string;
  label: string;
  /** 미리듣기용 원격 URL (없으면 들어보기 비활성) */
  previewUrl?: string | null;
  /** 미리듣기용 로컬 번들 에셋(require 결과). 프리셋용 — 있으면 previewUrl 보다 우선. */
  previewAsset?: number | null;
  /** 목록 섹션 구분: 'preset'=기본 제공 알림음 / 'recording'=직접 녹음(기본) */
  group?: 'preset' | 'recording';
}

interface Props {
  /** 이 알림에 현재 지정된 소리(custom_sound id). 없으면 기본 목소리 */
  soundId?: string | null;
  /** 그룹의 녹음 목록 */
  sounds: AlarmSoundOption[];
  /** 선택 시 호출. null이면 기본 목소리 */
  onSelect: (soundId: string | null) => void;
  /**
   * 트리거(알림 소리) 버튼의 배경색. 안 주면 기본(Colors.light, 연한 초록).
   * 부모 박스 배경색과 맞추고 싶을 때만 전달(예: 파란 박스 → 연한 파랑).
   * 글씨/아이콘은 Colors.dark 라 연한 배경 위 대비 유지됨.
   */
  backgroundColor?: string;
  /** 트리거 라벨·값 글자 크기 override(안 주면 기본 18). 주변 텍스트와 크기 맞출 때 사용. */
  fontSize?: number;
}

/**
 * 알림 카드 안에 붙는 "알림 소리" 버튼.
 * 누르면 바텀시트가 열려 녹음한 목소리 목록(+기본 목소리)에서 하나 고른다.
 * 각 목소리는 "들어보기"로 미리 재생할 수 있다.
 * 60대 타겟: 큰 글씨, 넉넉한 탭 영역, 아이콘+텍스트, 스와이프 다운 닫기.
 */
export function AlarmSoundPickerRow({ soundId, sounds, onSelect, backgroundColor, fontSize }: Props) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  // 임시 선택값 — 시트에서 고르면 여기에만 담고, '완료' 눌러야 실제 적용(onSelect).
  const [pendingId, setPendingId] = useState<string | null>(soundId ?? null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const current = soundId ? sounds.find((s) => s.id === soundId) : null;
  const currentLabel = current ? current.label : t('alarmSoundPicker.defaultVoice');

  // ── 미리듣기 재생/정지 ─────────────────────────────────────
  const stopPreview = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlayingId(null);
    if (s) await s.unloadAsync().catch(() => {});
  };

  const handlePreview = async (item: AlarmSoundOption) => {
    if (!item.previewUrl && !item.previewAsset) return;
    // 미리듣기를 누르면 그 소리를 자동 선택(임시선택) — 이후 '완료'로 적용.
    handleSelect(item.id);
    try {
      const wasPlaying = playingId === item.id;
      await stopPreview();
      if (wasPlaying) return; // 같은 항목 다시 누르면 멈춤(토글)

      setLoadingId(item.id);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        // Android: 이어피스가 아닌 스피커로, 다른 소리 낮추며 재생(무음/이어피스 라우팅 방지).
        playThroughEarpieceAndroid: false,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });
      // 프리셋: 로컬 번들 에셋 직접 재생. 녹음: 재생 전용 서명 URL(죽은 공개 URL 폴백 안 함).
      let created;
      if (item.previewAsset) {
        created = await Audio.Sound.createAsync(item.previewAsset as number, { shouldPlay: true, volume: 1.0 });
      } else {
        const previewUri = await resolvePlaybackUrl(item.previewUrl!);
        if (!previewUri) {
          setLoadingId(null);
          setPlayingId(null);
          dialog.alert({ title: t('alarmSound.playFailTitle'), message: t('alarmSound.playFailMsg') });
          return;
        }
        created = await Audio.Sound.createAsync({ uri: previewUri }, { shouldPlay: true });
      }
      const { sound } = created;
      soundRef.current = sound;
      setLoadingId(null);
      setPlayingId(item.id);
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.isLoaded && st.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
          setPlayingId(null);
        }
      });
    } catch {
      setLoadingId(null);
      setPlayingId(null);
      dialog.alert({ title: t('alarmSound.playFailTitle'), message: t('alarmSound.playFailMsg') });
    }
  };

  const close = () => {
    stopPreview();
    setOpen(false);
  };

  // 녹음한 알림음이 없을 때 → 알림음 녹음/관리 화면으로 바로 이동(시트 닫고).
  const goToSoundSettings = () => {
    close();
    navigateTo('Main', { screen: 'MyInfo', params: { screen: 'AlarmSoundSettings' } });
  };

  // 미리듣기할 수 있는 알림음이 하나라도 있을 때만 "미리듣기" 안내를 노출.
  const hasPreviewable = sounds.some((s) => !!s.previewUrl || !!s.previewAsset);
  // 섹션 분리: 프리셋(기본 제공) / 녹음(직접). group 미지정은 녹음으로 간주(기존 호환).
  const presetItems = sounds.filter((s) => s.group === 'preset');
  const recordingItems = sounds.filter((s) => s.group !== 'preset');

  // 시트에서 항목 탭 = 임시 선택만(즉시 적용 X). 적용은 '완료'에서.
  const handleSelect = (sid: string | null) => setPendingId(sid);
  // 완료: 임시 선택을 실제 적용. 닫기: 적용 안 하고 닫음.
  const handleDone = () => {
    onSelect(pendingId);
    close();
  };

  // 옵션 1개 렌더(프리셋·녹음 공통) — 선택 상태·미리듣기 버튼 포함.
  const renderOption = (s: AlarmSoundOption) => {
    const selected = pendingId === s.id;
    const isPlaying = playingId === s.id;
    const isLoading = loadingId === s.id;
    const canPreview = !!s.previewUrl || !!s.previewAsset;
    return (
      <TouchableOpacity
        key={s.id}
        style={[styles.option, selected && styles.optionSelected]}
        activeOpacity={0.8}
        onPress={() => handleSelect(s.id)}
      >
        <View style={styles.optionLeft}>
          <Text style={styles.optionText}>{s.label}</Text>
          {canPreview && (
            <TouchableOpacity
              style={[styles.previewBtn, isPlaying && styles.previewBtnActive]}
              activeOpacity={0.7}
              onPress={() => handlePreview(s)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={Colors.dark} />
              ) : (
                <Ionicons name={isPlaying ? 'stop' : 'play'} size={16} color={isPlaying ? Colors.white : Colors.dark} />
              )}
              <Text style={[styles.previewText, isPlaying && styles.previewTextActive]}>
                {isPlaying ? t('alarmSoundPicker.stop') : t('alarmSoundPicker.preview')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {selected && <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />}
      </TouchableOpacity>
    );
  };

  // 언마운트 시 재생 정리
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(close);
  useEffect(() => {
    if (open) {
      resetPosition();
      setPendingId(soundId ?? null); // 열 때마다 현재 적용값으로 임시선택 초기화
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {/* ── 트리거: 알림 소리 버튼 ── */}
      <TouchableOpacity
        style={[
          styles.triggerBtn,
          backgroundColor ? { backgroundColor } : null,
        ]}
        activeOpacity={0.7}
        onPress={() => setOpen(true)}
      >
        <Ionicons name="volume-high" size={20} color={Colors.textSub} style={styles.triggerIcon} />
        <Text style={[styles.triggerLabel, fontSize ? { fontSize } : null]}>{t('alarmSoundPicker.alarmSound')}</Text>
        {/* 값 컬럼: 라벨 오른쪽에서 시작 → 길면 글자크기 유지한 채 줄바꿈, 둘째 줄은 값 시작 위치에 정렬(약효추적 방식) */}
        <View style={styles.triggerValueCol}>
          <Text style={[styles.triggerValue, fontSize ? { fontSize } : null]}>
            {currentLabel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.textSub} style={styles.triggerChevron} />
      </TouchableOpacity>

      {/* ── 바텀시트 ── */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={close}
        >
          <Animated.View
            style={[
              styles.sheet,
              { paddingBottom: Math.max(28, insets.bottom + 16), transform: [{ translateY }] },
            ]}
            {...panHandlers}
            // 시트 내부 탭이 배경 닫힘으로 전파되지 않도록
            onStartShouldSetResponder={() => true}
          >
            {/* 드래그 핸들 */}
            <View style={styles.handle} />

            <Text style={styles.sheetTitle}>{t('alarmSoundPicker.pickTitle')}</Text>
            {hasPreviewable ? (
              <Text style={styles.sheetSub}>{t('alarmSoundPicker.pickSub')}</Text>
            ) : (
              <View style={{ height: 16 }} />
            )}

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {/* 기본 목소리 */}
              <TouchableOpacity
                style={[styles.option, !pendingId && styles.optionSelected]}
                activeOpacity={0.8}
                onPress={() => handleSelect(null)}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionText}>{t('alarmSoundPicker.defaultVoice')}</Text>
                  <Text style={styles.optionHint}>{t('alarmSoundPicker.defaultVoiceHint')}</Text>
                </View>
                {!pendingId && (
                  <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                )}
              </TouchableOpacity>

              {/* 기본 제공 알림음(프리셋) */}
              {presetItems.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>{t('alarmSoundPicker.presetSection')}</Text>
                  {presetItems.map(renderOption)}
                </>
              )}

              {/* 직접 녹음한 알림음 */}
              {recordingItems.length > 0 && (
                <>
                  <Text style={styles.sectionHeader}>{t('alarmSoundPicker.recordingSection')}</Text>
                  {recordingItems.map(renderOption)}
                </>
              )}

              {recordingItems.length === 0 && (
                <View style={styles.emptyWrap}>
                  <Text style={styles.empty}>{t('alarmSoundPicker.emptyLine1')}</Text>
                  {/* 글로만 안내하지 말고 해당 메뉴로 바로 보낸다(작은 텍스트 링크 금지 → 버튼). */}
                  <TouchableOpacity style={styles.emptyCtaBtn} activeOpacity={0.85} onPress={goToSoundSettings}>
                    <Ionicons name="mic-outline" size={18} color={Colors.white} />
                    <Text style={styles.emptyCtaText}>{t('alarmSoundPicker.goToSettings')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>

            {/* 닫기(적용 안 함) · 완료(임시선택 적용) 한 줄 */}
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.7} onPress={close}>
                <Text style={styles.cancelBtnText}>{t('common.close')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.doneBtn} activeOpacity={0.85} onPress={handleDone}>
                <Text style={styles.doneBtnText}>{t('doseSlotSetList.done')}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── 트리거 버튼 ──
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: Colors.light,
  },
  triggerIcon: { marginTop: 3 },
  triggerChevron: { marginTop: 4 },
  triggerLabel: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: Colors.text,
  },
  // 값 컬럼: 라벨 오른쪽 남은 폭 차지 → 줄바꿈 시 둘째 줄이 이 컬럼 왼쪽(값 시작 위치)에 정렬.
  triggerValueCol: {
    flex: 1,
  },
  triggerValue: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    color: Colors.dark,
  },

  // ── 바텀시트 ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  sheetSub: {
    fontSize: 15,
    color: Colors.textSub,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingBottom: 4,
  },

  // 섹션 제목(기본 제공 / 직접 녹음)
  sectionHeader: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textSub,
    marginTop: 6,
    marginBottom: 10,
    marginLeft: 2,
  },
  // ── 옵션 카드 ──
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  optionSelected: {
    backgroundColor: Colors.light,
    borderColor: Colors.primary,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  optionText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    flexShrink: 1,
  },
  optionHint: {
    fontSize: 14,
    color: Colors.textSub,
    fontWeight: '500',
  },

  // ── 들어보기 버튼 ──
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  previewText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
  },
  previewTextActive: {
    color: Colors.white,
  },

  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 16,
  },
  empty: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 25,
    textAlign: 'center',
  },
  emptyCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    maxWidth: '100%', // 시트 폭 초과 방지(긴 문구 시 넘침 대신 줄바꿈)
  },
  emptyCtaText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.white,
    flexShrink: 1,
    textAlign: 'center',
  },
  // 닫기·완료 한 줄
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  doneBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.white,
  },
});
