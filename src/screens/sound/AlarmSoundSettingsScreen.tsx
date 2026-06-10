import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import notifee from '@notifee/react-native';
import { ensureRecordedChannel, provisionForUser } from '../../lib/alarmSound';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { navigateTo } from '../../navigation/navigationRef';

const DEFAULT_LABEL = '내 녹음';

interface CustomSound {
  id: string;
  label: string | null;
  public_url: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface SoundPref {
  user_id: string;
  sound_type: 'system' | 'preset' | 'recorded';
  custom_sound_id: string | null;
}

/** 녹음 날짜를 "2026년 5월 31일" 형식으로 표시 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  } catch {
    return '';
  }
}

export function AlarmSoundSettingsScreen() {
  const { user } = useAuth();
  const dialog = useDialog();

  const [loading, setLoading] = useState(true);
  const [sounds, setSounds] = useState<CustomSound[]>([]);
  const [pref, setPref] = useState<SoundPref | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);

  // 언마운트 시 재생 리소스 정리
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const stopPreview = useCallback(async () => {
    if (soundRef.current) {
      await soundRef.current.unloadAsync().catch(() => {});
      soundRef.current = null;
    }
    setPlayingId(null);
  }, []);

  // ── 데이터 로드 ───────────────────────────────────────────
  const load = useCallback(async () => {
    if (!user) return;
    if (!user.patient_group_id) {
      setSounds([]);
      setPref(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [soundsRes, prefRes] = await Promise.all([
        supabase
          .from('custom_sounds' as any)
          .select('id, label, public_url, duration_ms, created_at')
          .eq('group_id', user.patient_group_id)
          .order('created_at', { ascending: false }),
        supabase
          .from('alarm_sound_prefs' as any)
          .select('user_id, sound_type, custom_sound_id')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      const sList = ((soundsRes.data as any[]) ?? []) as CustomSound[];
      const p = ((prefRes.data as any) ?? null) as SoundPref | null;
      setSounds(sList);
      setPref(p);
      // 기기에 현재 알림음 설정 전체(기본 + 항목별 목소리) 반영
      provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      setSounds([]);
      setPref(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 진입/복귀마다 갱신 + 떠날 때 재생 정리
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        stopPreview();
      };
    }, [load, stopPreview]),
  );

  // 현재 선택된 sound_type / custom_sound_id (없으면 기본 system)
  const currentType: 'system' | 'preset' | 'recorded' = pref?.sound_type ?? 'system';
  const currentCustomId = pref?.custom_sound_id ?? null;

  const currentLabel = (() => {
    if (currentType === 'recorded' && currentCustomId) {
      const s = sounds.find((x) => x.id === currentCustomId);
      return s ? s.label?.trim() || DEFAULT_LABEL : '저장된 녹음';
    }
    return '시스템 기본음';
  })();

  // ── 미리듣기 (원격 URL 재생) ───────────────────────────────
  const handlePlay = async (item: CustomSound) => {
    if (!item.public_url) {
      dialog.alert({
        title: '들을 수 없어요',
        message: '이 녹음은 재생 정보가 없어요.\n다시 녹음해 주세요.',
      });
      return;
    }
    try {
      // 재생 중인 게 있으면 정지(같은 항목 다시 누르면 토글로 멈춤)
      const wasPlaying = playingId === item.id;
      await stopPreview();
      if (wasPlaying) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      const { sound } = await Audio.Sound.createAsync(
        { uri: item.public_url },
        { shouldPlay: true },
      );
      soundRef.current = sound;
      setPlayingId(item.id);
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
          setPlayingId(null);
        }
      });
    } catch (e) {
      setPlayingId(null);
      dialog.alert({
        title: '재생할 수 없어요',
        message: '인터넷 연결을 확인하고 다시 시도해 주세요.',
      });
    }
  };

  // ── [PoC] 실제 알림으로 테스트 (notifee 커스텀 사운드 검증) ──
  // 런타임에 다운로드한 녹음 파일을 Android 알림 채널 사운드로 실제 재생되는지 확인.
  const handleTestAlarm = async (item: CustomSound) => {
    if (!item.public_url) {
      dialog.alert({ title: '테스트할 수 없어요', message: '재생 정보가 없는 녹음이에요.' });
      return;
    }
    if (Platform.OS !== 'android') {
      dialog.alert({
        title: '안드로이드에서 확인해요',
        message: 'iOS 알림음 테스트는 다음 단계에서 진행해요.',
      });
      return;
    }
    setTestingId(item.id);
    try {
      await notifee.requestPermission();
      // 실제 적용과 동일한 채널로 프로비저닝한 뒤 테스트 알림 발송
      const channelId = await ensureRecordedChannel(
        item.id,
        item.public_url,
        item.label?.trim() || DEFAULT_LABEL,
      );
      await notifee.displayNotification({
        title: '🔔 파킨온 약 알림 (테스트)',
        body: `${item.label?.trim() || DEFAULT_LABEL} 목소리로 울리면 성공이에요!`,
        android: {
          channelId,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
        },
      });
    } catch (e: any) {
      dialog.alert({
        title: '테스트 실패',
        message: String(e?.message ?? e),
      });
    } finally {
      setTestingId(null);
    }
  };

  // ── 이걸로 설정 (녹음 선택) ────────────────────────────────
  const handleSelectRecorded = async (item: CustomSound) => {
    if (!user) return;
    setSavingId(item.id);
    try {
      const { error } = await supabase.from('alarm_sound_prefs' as any).upsert(
        {
          user_id: user.id,
          sound_type: 'recorded',
          custom_sound_id: item.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(error.message);
      const newPref = {
        user_id: user.id,
        sound_type: 'recorded' as const,
        custom_sound_id: item.id,
      };
      setPref(newPref);
      // 기기에 알림음 설정 전체(기본 + 항목별) 즉시 재프로비저닝
      await provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
      dialog.alert({
        title: '설정 완료',
        message: '이 녹음을 알림음으로 설정했어요.',
      });
    } catch (e) {
      dialog.alert({
        title: '설정에 실패했어요',
        message: '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSavingId(null);
    }
  };

  // ── 시스템 기본음 선택 ────────────────────────────────────
  const handleSelectSystem = async () => {
    if (!user) return;
    setSavingId('system');
    try {
      const { error } = await supabase.from('alarm_sound_prefs' as any).upsert(
        {
          user_id: user.id,
          sound_type: 'system',
          custom_sound_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(error.message);
      setPref({ user_id: user.id, sound_type: 'system', custom_sound_id: null });
      // 기본 목소리는 시스템음으로 바뀌어도, 항목별 목소리 채널은 유지되도록 전체 재프로비저닝
      await provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      dialog.alert({
        title: '설정에 실패했어요',
        message: '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSavingId(null);
    }
  };

  // ── 삭제 ──────────────────────────────────────────────────
  const handleDelete = async (item: CustomSound) => {
    if (!user) return;
    const ok = await dialog.confirm({
      title: '녹음 삭제',
      message: '이 녹음을 삭제할까요?\n삭제하면 되돌릴 수 없어요.',
      confirmText: '삭제하기',
      cancelText: '취소',
      destructive: true,
    });
    if (!ok) return;

    // 재생 중이면 정지
    if (playingId === item.id) await stopPreview();

    setDeletingId(item.id);
    try {
      // 같은 가족이면 누구나 삭제 가능 (SECURITY DEFINER RPC)
      const { data: ok, error } = await (supabase.rpc as any)('delete_custom_sound', {
        p_sound_id: item.id,
      });
      if (error) throw new Error(error.message);

      if (!ok) {
        dialog.alert({
          title: '삭제할 수 없어요',
          message: '같은 가족만 이 녹음을 삭제할 수 있어요.',
        });
        return;
      }

      // 삭제한 게 현재 선택이면 시스템 기본음으로 리셋 + 채널 정리
      const wasSelected = currentType === 'recorded' && currentCustomId === item.id;
      if (wasSelected) {
        await supabase.from('alarm_sound_prefs' as any).upsert(
          {
            user_id: user.id,
            sound_type: 'system',
            custom_sound_id: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
        setPref({ user_id: user.id, sound_type: 'system', custom_sound_id: null });
        await provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
      }

      // 목록 갱신
      await load();
    } catch (e) {
      dialog.alert({
        title: '삭제에 실패했어요',
        message: '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // ── 가족 연동 안 된 경우 안내 ──────────────────────────────
  if (user && !user.patient_group_id) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <TopBar title="알림음 설정" showBack />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>가족 연동이 필요해요</Text>
          <Text style={styles.emptyText}>
            알림음을 설정하려면 먼저 가족 연동을 해 주세요.{'\n'}
            메뉴에서 가족 연동을 진행할 수 있어요.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const systemSelected = currentType === 'system' || currentType === 'preset';

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="알림음 설정" showBack />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 현재 알림음 */}
        <View style={styles.currentBox}>
          <Text style={styles.currentLabel}>현재 알림음</Text>
          <Text style={styles.currentValue}>{currentLabel}</Text>
        </View>

        {/* 안내 문구 */}
        <Text style={styles.noticeText}>
          선택한 알림음은 곧 실제 알림에 적용됩니다.
        </Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : (
          <>
            {/* 시스템 기본음 */}
            <TouchableOpacity
              style={[styles.card, systemSelected && styles.cardSelected]}
              onPress={handleSelectSystem}
              activeOpacity={0.85}
              disabled={savingId === 'system'}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>시스템 기본음</Text>
                {systemSelected && (
                  <Text style={styles.selectedTag}>선택됨</Text>
                )}
              </View>
              <Text style={styles.cardSub}>휴대폰 기본 알림음을 사용해요</Text>
              {!systemSelected && (
                <View style={[styles.actionBtn, styles.setBtn, styles.fullBtn]}>
                  {savingId === 'system' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.setBtnText}>이걸로 설정</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>

            {/* 저장된 녹음 목록 */}
            <Text style={styles.sectionTitle}>저장된 녹음</Text>

            {sounds.length === 0 ? (
              <View style={styles.noSoundsBox}>
                <Text style={styles.noSoundsText}>
                  아직 저장된 녹음이 없어요.{'\n'}
                  아래 버튼으로 새 알림음을 녹음해 보세요.
                </Text>
              </View>
            ) : (
              sounds.map((item) => {
                const isSelected =
                  currentType === 'recorded' && currentCustomId === item.id;
                const isPlaying = playingId === item.id;
                const isSaving = savingId === item.id;
                return (
                  <View
                    key={item.id}
                    style={[styles.card, isSelected && styles.cardSelected]}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>
                        {item.label?.trim() || DEFAULT_LABEL}
                      </Text>
                      {isSelected && (
                        <Text style={styles.selectedTag}>선택됨</Text>
                      )}
                    </View>
                    <Text style={styles.cardSub}>
                      {formatDate(item.created_at)}
                    </Text>

                    {/* 들어보기 (전체 폭) */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.playBtn, styles.fullBtn]}
                      onPress={() => handlePlay(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.playBtnText}>
                        {isPlaying ? '■ 멈추기' : '▶ 들어보기'}
                      </Text>
                    </TouchableOpacity>

                    {/* [PoC] 실제 알림으로 테스트 */}
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.testBtn, styles.fullBtn]}
                      onPress={() => handleTestAlarm(item)}
                      activeOpacity={0.85}
                      disabled={testingId === item.id}
                    >
                      {testingId === item.id ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.testBtnText}>🔔 실제 알림으로 테스트</Text>
                      )}
                    </TouchableOpacity>

                    {/* 설정 + 삭제 */}
                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[
                          styles.actionBtn,
                          styles.setBtn,
                          styles.flexBtn,
                          isSelected && styles.setBtnDisabled,
                        ]}
                        onPress={() => handleSelectRecorded(item)}
                        activeOpacity={0.85}
                        disabled={isSelected || isSaving}
                      >
                        {isSaving ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.setBtnText}>
                            {isSelected ? '설정됨' : '이걸로 설정'}
                          </Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn, styles.flexBtn]}
                        onPress={() => handleDelete(item)}
                        activeOpacity={0.85}
                        disabled={deletingId === item.id}
                      >
                        {deletingId === item.id ? (
                          <View style={styles.deleteBusyRow}>
                            <ActivityIndicator color={Colors.danger} />
                            <Text style={styles.deleteBtnText}>삭제 중...</Text>
                          </View>
                        ) : (
                          <Text style={styles.deleteBtnText}>삭제</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}

            {/* 새 알림음 녹음 */}
            <TouchableOpacity
              style={[styles.bigButton, styles.recordButton]}
              onPress={() => navigateTo('RecordSound')}
              activeOpacity={0.85}
            >
              <Text style={styles.bigButtonText}>+ 새 알림음 녹음</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },

  // 현재 알림음
  currentBox: {
    backgroundColor: Colors.light,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  currentLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark,
    marginBottom: 6,
  },
  currentValue: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.text,
  },

  // 안내 문구
  noticeText: {
    fontSize: 15,
    color: Colors.textSub,
    marginBottom: 20,
    lineHeight: 21,
  },

  // 로딩
  loadingWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },

  // 섹션 제목
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 24,
    marginBottom: 12,
  },

  // 카드
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    flexShrink: 1,
  },
  selectedTag: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
    marginLeft: 8,
  },
  cardSub: {
    fontSize: 17,
    color: Colors.textSub,
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 14,
  },

  // 액션 버튼 공통
  actionBtn: {
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  fullBtn: {
    width: '100%',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  flexBtn: {
    flex: 1,
  },
  playBtn: {
    backgroundColor: Colors.accent,
  },
  playBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  testBtn: {
    backgroundColor: Colors.dark,
    marginTop: 12,
  },
  testBtnText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
  },
  setBtn: {
    backgroundColor: Colors.primary,
  },
  setBtnDisabled: {
    backgroundColor: Colors.textHint,
  },
  setBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  deleteBtn: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.danger,
  },
  deleteBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.danger,
  },
  deleteBusyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // 저장된 녹음 없음
  noSoundsBox: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    marginBottom: 14,
  },
  noSoundsText: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 26,
    fontWeight: '500',
    textAlign: 'center',
  },

  // 새 녹음 버튼
  bigButton: {
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 12,
  },
  recordButton: {
    backgroundColor: Colors.dark,
  },
  bigButtonText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
  },

  // 가족 연동 안내
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 26,
    fontWeight: '500',
    textAlign: 'center',
  },
});
