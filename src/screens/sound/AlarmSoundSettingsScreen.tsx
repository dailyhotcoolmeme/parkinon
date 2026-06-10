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
  const [playingId, setPlayingId] = useState<string | null>(null);
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
      setSounds(sList);
      // 기기에 현재 알림음 설정 전체(기본 + 항목별 목소리) 반영
      provisionForUser(user.id, user.patient_group_id ?? null).catch(() => {});
    } catch (e) {
      setSounds([]);
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
        <TopBar title="알림음 관리" showBack />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>가족 연동이 필요해요</Text>
          <Text style={styles.emptyText}>
            알림음을 만들려면 먼저 가족 연동을 해 주세요.{'\n'}
            메뉴에서 가족 연동을 진행할 수 있어요.
          </Text>
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
            <Text style={styles.loadingText}>불러오는 중...</Text>
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
                        <Text style={styles.cardSub}>
                          {formatDate(item.created_at)}
                        </Text>
                      </View>
                      <View style={styles.headerActions}>
                        <TouchableOpacity
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.iconBtn}
                          onPress={() =>
                            navigateTo('RecordSound', {
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

                    {/* 알림음 들어보기 (큰 버튼, 녹색) */}
                    <TouchableOpacity
                      style={[styles.playBtn, isPlaying && styles.playBtnStop]}
                      onPress={() => handlePlay(item)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.playBtnText}>
                        {isPlaying ? '■ 멈추기' : '▶ 알림음 들어보기'}
                      </Text>
                    </TouchableOpacity>

                    {/* 실제 알림 테스트해보기 (보조, 점선 회색) */}
                    <TouchableOpacity
                      style={styles.testBtn}
                      onPress={() => handleTestAlarm(item)}
                      activeOpacity={0.85}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <ActivityIndicator color={Colors.textSub} />
                      ) : (
                        <Text style={styles.testBtnText}>
                          🔔 실제 알림 테스트해보기
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })
            )}

            {/* 새 알림음 등록 */}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => navigateTo('RecordSound')}
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

  // 알림음 들어보기 (큰 버튼, 녹색)
  playBtn: {
    minHeight: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginTop: 16,
  },
  playBtnStop: {
    backgroundColor: Colors.dark,
  },
  playBtnText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
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

  // 실제 알림 테스트 (보조, 점선 회색)
  testBtn: {
    minHeight: 50,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    marginTop: 12,
  },
  testBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
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
