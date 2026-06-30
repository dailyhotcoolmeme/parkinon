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
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import notifee from '@notifee/react-native';
import * as Notifications from 'expo-notifications';
import {
  ensureRecordedChannel,
  ensureRecordedSoundIOS,
  provisionForUser,
} from '../../lib/alarmSound';
import * as AlarmSoundNative from '../../../modules/alarm-sound';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';
import { resolveMediaUrl } from '../../lib/r2Get';

const DEFAULT_LABEL = '내 녹음';

interface CustomSound {
  id: string;
  label: string | null;
  public_url: string | null;
  duration_ms: number | null;
  created_at: string;
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
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState(true);
  const [sounds, setSounds] = useState<CustomSound[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  // 복제 지연으로 load() 가 옛 데이터를 줘도 화면이 되돌아가지 않도록 하는 낙관적 보정 큐.
  //  - 삭제: 서버 목록에 아직 남아 있어도 숨김. 서버가 따라잡으면(목록에서 사라지면) 정리.
  //  - 수정: 서버 라벨/URL 이 옛 값이면 새 값으로 덮어 표시. 서버가 새 값이 되면 보정 해제.
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set());
  const pendingEditsRef = useRef<Record<string, Partial<CustomSound>>>({});

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
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const soundsRes = await supabase
        .from('custom_sounds' as any)
        .select('id, label, public_url, duration_ms, created_at')
        .eq('group_id', user.patient_group_id)
        .order('created_at', { ascending: false });

      const sList = ((soundsRes.data as any[]) ?? []) as CustomSound[];
      // 낙관적 보정 적용 (삭제 숨김 / 수정 덮어쓰기), 서버가 따라잡은 항목은 보정 해제
      const delIds = pendingDeleteIdsRef.current;
      const edits = pendingEditsRef.current;
      const seen = new Set<string>();
      const merged: CustomSound[] = [];
      for (const s of sList) {
        seen.add(s.id);
        if (delIds.has(s.id)) continue; // 삭제 대기 → 숨김
        const e = edits[s.id];
        if (e) {
          const labelDone = e.label === undefined || s.label === e.label;
          const urlDone = e.public_url == null || s.public_url === e.public_url;
          if (labelDone && urlDone) {
            delete edits[s.id]; // 서버 반영 완료 → 보정 해제
            merged.push(s);
          } else {
            merged.push({ ...s, ...e });
          }
        } else {
          merged.push(s);
        }
      }
      // 서버 목록에서 사라진 삭제대기 id 정리 (서버가 따라잡음)
      for (const id of Array.from(delIds)) if (!seen.has(id)) delIds.delete(id);
      setSounds(merged);
      // 기기에 현재 알림음 설정 전체(기본 + 항목별 목소리) 반영
      provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      setSounds([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 수정 화면(RecordSound)에서 돌아올 때 전달된 변경분을 즉시 반영 (복제 지연 대비)
  useEffect(() => {
    const u = route.params?.updatedSound as
      | { id: string; label?: string; public_url?: string | null; duration_ms?: number | null }
      | undefined;
    if (!u?.id) return;
    const patch: Partial<CustomSound> = {};
    if (u.label !== undefined) patch.label = u.label;
    if (u.public_url) {
      patch.public_url = u.public_url;
      if (u.duration_ms !== undefined && u.duration_ms !== null) patch.duration_ms = u.duration_ms;
    }
    pendingEditsRef.current[u.id] = { ...(pendingEditsRef.current[u.id] ?? {}), ...patch };
    setSounds((prev) => prev.map((s) => (s.id === u.id ? { ...s, ...patch } : s)));
    navigation.setParams({ updatedSound: undefined }); // 소비 후 제거 (재병합 방지)
  }, [route.params?.updatedSound, navigation]);

  // 진입/복귀마다 갱신 + 떠날 때 재생 정리
  useFocusEffect(
    useCallback(() => {
      load();
      return () => {
        stopPreview();
      };
    }, [load, stopPreview]),
  );

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

      // 원격 음원 로딩 동안 스피너 표시(누르고 소리 날 때까지 텀 대비)
      setPreparingId(item.id);
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      // presigned GET URL 로 변환(실패 시 원본 공개 URL 폴백)
      const previewUri = await resolveMediaUrl(item.public_url);
      const { sound } = await Audio.Sound.createAsync(
        { uri: previewUri },
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
    } finally {
      setPreparingId(null);
    }
  };

  // ── 실제 알림으로 테스트 (커스텀 사운드 검증) ──
  // Android: 런타임 녹음 파일을 알림 채널 사운드로 설치해 실제 재생되는지 확인(검증 완료).
  // iOS: caf 를 Library/Sounds 에 설치한 뒤 로컬 알림 sound 에 그 파일명을 지정해 확인.
  //   ⚠️ 네이티브 모듈은 새 빌드부터 활성 → 빌드 전(현재 OTA 런타임)에는 AlarmSoundNative
  //      .isAvailable=false 라 설치/재생이 불가하므로 크래시 없이 안내만 한다.
  const handleTestAlarm = async (item: CustomSound) => {
    if (!item.public_url) {
      dialog.alert({ title: '테스트할 수 없어요', message: '재생 정보가 없는 녹음이에요.' });
      return;
    }
    setTestingId(item.id);
    try {
      if (Platform.OS === 'ios') {
        // 네이티브 알림음 모듈이 없으면(빌드 전) caf 설치 불가 → 안전 안내(크래시 방지).
        if (!AlarmSoundNative.isAvailable) {
          dialog.alert({
            title: '앱 업데이트 후 사용할 수 있어요',
            message:
              '아이폰 알림음 테스트는 다음 앱 업데이트부터 사용할 수 있어요.\n그때까지는 기본 알림음으로 울려요.',
          });
          return;
        }
        // Library/Sounds/<파일명>.caf 설치(이미 있으면 skip) 후 그 파일명으로 로컬 알림 발송
        const fileName = await ensureRecordedSoundIOS(item.id, item.public_url);
        if (!fileName) {
          dialog.alert({
            title: '테스트 준비 실패',
            message: '알림음 파일을 준비하지 못했어요.\n인터넷 연결을 확인하고 다시 시도해 주세요.',
          });
          return;
        }
        await Notifications.requestPermissionsAsync();
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🔔 파킨온 약 알림 (테스트)',
            body: `${item.label?.trim() || DEFAULT_LABEL} 목소리로 울리면 성공이에요!\n휴대폰이 무음 모드면 소리가 들리지 않아요.`,
            // iOS 는 Library/Sounds/<파일명> 에 설치된 caf 파일명을 sound 에 지정.
            // (서버 푸시도 동일 파일명 alarmSoundFileNameIOS(item.id) 를 보냄)
            sound: fileName,
          },
          trigger: null, // 즉시
        });
        return;
      }

      // ── Android ──
      await notifee.requestPermission();
      // 실제 적용과 동일한 채널로 프로비저닝한 뒤 테스트 알림 발송
      const channelId = await ensureRecordedChannel(
        item.id,
        item.public_url,
        item.label?.trim() || DEFAULT_LABEL,
      );
      await notifee.displayNotification({
        title: '🔔 파킨온 약 알림 (테스트)',
        body: `${item.label?.trim() || DEFAULT_LABEL} 목소리로 울리면 성공이에요!\n휴대폰이 진동 모드면 소리가 들리지 않아요.`,
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

      // 즉시 목록에서 제거 + 삭제 대기 큐 등록 (복제 지연 재조회가 되살리지 못하게)
      pendingDeleteIdsRef.current.add(item.id);
      setSounds((prev) => prev.filter((s) => s.id !== item.id));
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
        <TopBar title="알림음 관리" showBack />
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>환자를 먼저 연동해주세요</Text>
          <Text style={styles.unlinkedDesc}>{'가족을 연동하면 환자분의\n알림음을 만들 수 있어요'}</Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            onPress={() => navigation.navigate('FamilyLink')}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>가족 연동하기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="알림음 관리" showBack />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>불러오고 있어요…</Text>
          </View>
        ) : (
          <>
            {/* 상단 안내 한 줄 */}
            <Text style={styles.intro}>
              알림이 울릴 때 들리는 소리를 만들고 관리해요.
            </Text>

            {sounds.length === 0 ? (
              <View style={styles.noSoundsBox}>
                <Text style={styles.noSoundsText}>
                  아직 만든 알림음이 없어요.{'\n'}
                  아래에서 새로 등록해 보세요.
                </Text>
              </View>
            ) : (
              sounds.map((item) => {
                const isPlaying = playingId === item.id;
                const isPreparing = preparingId === item.id;
                const isDeleting = deletingId === item.id;
                const isTesting = testingId === item.id;
                return (
                  <View key={item.id} style={styles.card}>
                    {/* 헤더: 아이콘 + 이름 + 날짜 + 우측 상단 수정/삭제(아이콘) */}
                    <View style={styles.cardHeader}>
                      <View style={styles.cardIcon}>
                        <Text style={styles.cardIconText}>🎙</Text>
                      </View>
                      <View style={styles.cardHeaderText}>
                        <Text style={styles.cardTitle}>
                          {item.label?.trim() || DEFAULT_LABEL}
                        </Text>
                      </View>
                      <View style={styles.headerActions}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.iconBtn}
                          onPress={() =>
                            navigation.navigate('RecordSound', {
                              editSoundId: item.id,
                              editLabel: item.label?.trim() || DEFAULT_LABEL,
                            })
                          }
                        >
                          <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.iconBtnDelete}
                          onPress={() => handleDelete(item)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <ActivityIndicator size="small" color={Colors.danger} />
                          ) : (
                            <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* 들어보기 · 알림 테스트 (한 줄) */}
                    <View style={styles.btnRow}>
                      <TouchableOpacity
                        style={[styles.playBtn, isPlaying && styles.playBtnStop]}
                        onPress={() => handlePlay(item)}
                        activeOpacity={0.85}
                        disabled={isPreparing}
                      >
                        {isPreparing ? (
                          <ActivityIndicator color={Colors.dark} />
                        ) : (
                          <>
                            <Ionicons
                              name={isPlaying ? 'stop' : 'play'}
                              size={20}
                              color={Colors.dark}
                              style={styles.btnIcon}
                            />
                            <Text style={styles.playBtnText}>
                              {isPlaying ? '멈추기' : '들어보기'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.testBtn}
                        onPress={() => handleTestAlarm(item)}
                        activeOpacity={0.85}
                        disabled={isTesting}
                      >
                        {isTesting ? (
                          <ActivityIndicator color={Colors.textSub} />
                        ) : (
                          <>
                            <Ionicons
                              name="notifications"
                              size={20}
                              color={Colors.dark}
                              style={styles.btnIcon}
                            />
                            <Text style={styles.testBtnText}>알림 테스트</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.testHint}>
                      ⓘ 휴대폰이 진동 모드면 소리가 들리지 않아요
                    </Text>
                  </View>
                );
              })
            )}

            {/* 새 알림음 등록 */}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => navigation.navigate('RecordSound')}
              activeOpacity={0.85}
            >
              <Text style={styles.addButtonText}>＋ 새 알림음 등록</Text>
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

  // 상단 안내
  intro: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '500',
    lineHeight: 24,
    marginTop: 4,
    marginBottom: 18,
  },

  // 카드
  card: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: {
    fontSize: 22,
  },
  cardHeaderText: {
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBtn: {
    marginLeft: 12,
    padding: 4,
  },
  iconBtnDelete: {
    marginLeft: 8,
    padding: 4,
  },
  cardTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: Colors.text,
  },
  cardSub: {
    fontSize: 14,
    color: Colors.textSub,
    fontWeight: '500',
    marginTop: 3,
  },

  // 들어보기 · 알림 테스트 한 줄
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  btnIcon: {
    marginRight: 6,
  },
  // 알림음 들어보기 (심플 — 설정 행 스타일 차용)
  playBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light,
  },
  playBtnStop: {
    backgroundColor: '#E6E6E6',
  },
  playBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },

  // 수정/삭제 한 줄
  actsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    backgroundColor: Colors.white,
  },
  editBtn: {
    borderColor: Colors.primary,
  },
  editBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark,
  },
  delBtn: {
    borderColor: Colors.danger,
  },
  delBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.danger,
  },

  // 실제 알림 테스트 (심플 — 들어보기와 동일 높이·스타일)
  testBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.light,
  },
  testBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },
  testHint: {
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },

  // 저장된 녹음 없음
  noSoundsBox: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 28,
    marginBottom: 16,
  },
  noSoundsText: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 28,
    fontWeight: '500',
    textAlign: 'center',
  },

  // 새 알림음 등록 버튼
  addButton: {
    minHeight: 62,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 8,
    backgroundColor: Colors.primary,
  },
  addButtonText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },

  // 미연동 보호자 안내(가족 연동 유도) — 기준 화면(기록 보기·영상 기록)과 동일한 중앙 심플 안내
  unlinkedWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  unlinkedTitle: {
    fontSize: 20,
    color: Colors.textSub,
    marginTop: 16,
    fontWeight: '600',
  },
  unlinkedDesc: {
    fontSize: 18,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 26,
  },
  linkFamilyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    marginTop: 24,
  },
  linkFamilyBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
});
