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

export interface AlarmSoundOption {
  id: string;
  label: string;
  /** 미리듣기용 원격 URL (없으면 들어보기 비활성) */
  previewUrl?: string | null;
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
}

/**
 * 알림 카드 안에 붙는 "알림 소리" 버튼.
 * 누르면 바텀시트가 열려 녹음한 목소리 목록(+기본 목소리)에서 하나 고른다.
 * 각 목소리는 "들어보기"로 미리 재생할 수 있다.
 * 60대 타겟: 큰 글씨, 넉넉한 탭 영역, 아이콘+텍스트, 스와이프 다운 닫기.
 */
export function AlarmSoundPickerRow({ soundId, sounds, onSelect, backgroundColor }: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const current = soundId ? sounds.find((s) => s.id === soundId) : null;
  const currentLabel = current ? current.label : '기본 목소리';

  // ── 미리듣기 재생/정지 ─────────────────────────────────────
  const stopPreview = async () => {
    const s = soundRef.current;
    soundRef.current = null;
    setPlayingId(null);
    if (s) await s.unloadAsync().catch(() => {});
  };

  const handlePreview = async (item: AlarmSoundOption) => {
    if (!item.previewUrl) return;
    try {
      const wasPlaying = playingId === item.id;
      await stopPreview();
      if (wasPlaying) return; // 같은 항목 다시 누르면 멈춤(토글)

      setLoadingId(item.id);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: item.previewUrl },
        { shouldPlay: true },
      );
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
    }
  };

  const close = () => {
    stopPreview();
    setOpen(false);
  };

  const handlePick = (sid: string | null) => {
    onSelect(sid);
    close();
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
    if (open) resetPosition();
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
        <Ionicons name="volume-high" size={20} color={Colors.dark} />
        <Text style={styles.triggerLabel}>알림 소리</Text>
        <View style={styles.triggerValueWrap}>
          <Text style={styles.triggerValue} numberOfLines={1}>
            {currentLabel}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSub} />
        </View>
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

            <Text style={styles.sheetTitle}>알림 소리 고르기</Text>
            <Text style={styles.sheetSub}>들어보기로 미리 확인할 수 있어요</Text>

            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {/* 기본 목소리 */}
              <TouchableOpacity
                style={[styles.option, !soundId && styles.optionSelected]}
                activeOpacity={0.8}
                onPress={() => handlePick(null)}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.optionText}>기본 목소리</Text>
                  <Text style={styles.optionHint}>휴대폰 기본 알림음</Text>
                </View>
                {!soundId && (
                  <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                )}
              </TouchableOpacity>

              {sounds.map((s) => {
                const selected = soundId === s.id;
                const isPlaying = playingId === s.id;
                const isLoading = loadingId === s.id;
                return (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.option, selected && styles.optionSelected]}
                    activeOpacity={0.8}
                    onPress={() => handlePick(s.id)}
                  >
                    <View style={styles.optionLeft}>
                      <Text style={styles.optionText} numberOfLines={1}>
                        {s.label}
                      </Text>
                      {!!s.previewUrl && (
                        <TouchableOpacity
                          style={[styles.previewBtn, isPlaying && styles.previewBtnActive]}
                          activeOpacity={0.7}
                          onPress={() => handlePreview(s)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          {isLoading ? (
                            <ActivityIndicator size="small" color={Colors.dark} />
                          ) : (
                            <Ionicons
                              name={isPlaying ? 'stop' : 'play'}
                              size={16}
                              color={isPlaying ? Colors.white : Colors.dark}
                            />
                          )}
                          <Text style={[styles.previewText, isPlaying && styles.previewTextActive]}>
                            {isPlaying ? '멈춤' : '들어보기'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {sounds.length === 0 && (
                <Text style={styles.empty}>
                  아직 녹음한 알림음이 없어요.{'\n'}
                  메뉴 → 알림음 설정에서 만들 수 있어요.
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.closeBtn}
              activeOpacity={0.85}
              onPress={close}
            >
              <Text style={styles.closeBtnText}>닫기</Text>
            </TouchableOpacity>
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
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: Colors.light,
  },
  triggerLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },
  triggerValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
    flexShrink: 1,
  },
  triggerValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.primary,
    flexShrink: 1,
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

  empty: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 25,
    textAlign: 'center',
    paddingVertical: 24,
  },
  closeBtn: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  closeBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
});
