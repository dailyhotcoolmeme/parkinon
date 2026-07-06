import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonList } from '../../components/common/SkeletonCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { TopBar } from '../../components/common/TopBar';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { navigateTo } from '../../navigation/navigationRef';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────
interface NotifLog {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

interface Section {
  title: string;
  data: NotifLog[];
}


// ─────────────────────────────────────────────
// 알림 타입 설정
// ─────────────────────────────────────────────
const NOTIF_CONFIG: Record<
  string,
  { icon: string; bgColor: string; iconColor: string; tappable: boolean; navigateTo?: string }
> = {
  medication_reminder:  { icon: 'medkit',           bgColor: '#E8F5E9', iconColor: '#2E7D32', tappable: true,  navigateTo: 'Medication' },
  effect_tracking:      { icon: 'body',             bgColor: '#FFF3E0', iconColor: '#E65100', tappable: true,  navigateTo: 'BodyStateTab' },
  exercise_reminder:    { icon: 'walk',             bgColor: '#E3F2FD', iconColor: '#1565C0', tappable: true,  navigateTo: 'Exercise' },
  missed_medication:    { icon: 'alert-circle',     bgColor: '#FFEBEE', iconColor: '#B71C1C', tappable: true,  navigateTo: 'Medication' },
  caregiver_medication: { icon: 'checkmark-circle', bgColor: '#E8F5E9', iconColor: '#2E7D32', tappable: false },
  caregiver_body_state: { icon: 'happy',            bgColor: '#FFF3E0', iconColor: '#E65100', tappable: false },
  caregiver_exercise:   { icon: 'fitness',          bgColor: '#E3F2FD', iconColor: '#1565C0', tappable: false },
  caregiver_missed_med: { icon: 'warning',          bgColor: '#FFEBEE', iconColor: '#B71C1C', tappable: false },
};
const DEFAULT_NOTIF_CONFIG = { icon: 'notifications', bgColor: '#F5F5F5', iconColor: '#616161', tappable: false };

// ─────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────
function groupByDate(logs: NotifLog[]): Section[] {
  const locale = isEnLocale() ? 'en-US' : 'ko-KR';
  const groups: Record<string, NotifLog[]> = {};
  const today = new Date().toLocaleDateString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  for (const log of logs) {
    const d = new Date(log.created_at);
    const dateKey = d.toLocaleDateString(locale, {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(log);
  }

  return Object.entries(groups).map(([key, data]) => ({
    title:
      key === today
        ? i18n.t('notifHistory.today')
        : key === yesterday
        ? i18n.t('notifHistory.yesterday')
        : new Date(data[0].created_at).toLocaleDateString(locale, {
            month: 'long',
            day: 'numeric',
          }),
    data,
  }));
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  if (isEnLocale()) return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}:${String(m).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export function NotificationHistoryScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { markAllRead, markRead, refreshBadge } = useNotificationBadge();
  const navigation = useNavigation();

  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  // 항목 탭 재진입 가드 — 빠른 더블탭/연속 탭으로 navigate가 겹쳐 스택이 꼬이는 것을 방지.
  const navInFlightRef = useRef(false);

  const fetchLogs = useCallback(
    async (targetDays: number) => {
      if (!user?.id) return;
      setLoading(true);

      const since = new Date(Date.now() - targetDays * 86400000).toISOString();

      let query = supabase
        .from('notification_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (!error && data) {
        setSections(groupByDate(data as NotifLog[]));
      }
      setLoading(false);
    },
    [user?.id],
  );

  useFocusEffect(
    useCallback(() => {
      fetchLogs(days);
    }, [fetchLogs, days]),
  );

  const handleExpandDays = () => {
    setDays(30);
    fetchLogs(30);
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    const now = new Date().toISOString();
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        data: section.data.map((d) => ({ ...d, read_at: d.read_at ?? now })),
      }))
    );
    refreshBadge();
  };

  const handleItemPress = async (item: NotifLog) => {
    // ⚠️ 안전망: 알림 내역 항목 탭은 어떤 경우에도 앱을 죽이면 안 된다.
    //   읽음 처리·UI 갱신·navigate 전체를 try/catch 로 감싸고, 실패 시 조용히 무시한다.
    try {
      const config = NOTIF_CONFIG[item.type] ?? DEFAULT_NOTIF_CONFIG;
      const data = (item.data ?? {}) as Record<string, any>;

      // 읽음 처리 (미읽 항목만) — 실패해도 navigate 는 계속 진행
      if (!item.read_at) {
        try {
          await markRead(item.id);
          refreshBadge();
        } catch (e) {
          console.warn('[NotificationHistory] markRead 실패(무시):', e);
        }
      }

      // 읽음 상태로 UI 갱신
      setSections((prev) =>
        prev.map((section) => ({
          ...section,
          data: section.data.map((d) =>
            d.id === item.id ? { ...d, read_at: new Date().toISOString() } : d,
          ),
        })),
      );

      // tappable 이 아니면 여기서 끝(보호자 알림 등) — navigate 하지 않는다.
      if (!config.tappable || !config.navigateTo) return;

      // 재진입 가드 — navigate 진행 중 추가 탭 무시(스택 꼬임·흰화면 방지).
      if (navInFlightRef.current) return;
      navInFlightRef.current = true;
      // 가드는 잠깐만 — 화면 전환이 끝나는 시간(800ms) 후 해제.
      setTimeout(() => {
        navInFlightRef.current = false;
      }, 800);

      // ── OS 알림 탭과 동일한 진입 경로 사용 ──────────────────────────
      // App.tsx handleNotificationResponse 와 같은 방식으로 처리한다:
      //   ① 다른 타입의 잔존 pending* 키를 먼저 제거(cross-type stale cleanup)
      //   ② 해당 타입의 pending* 키를 세팅
      //   ③ navigateTo('Main', navArgs) 로 RootStack 기준 전역 navigate
      // 이렇게 해야 타깃 화면(Medication/BodyState/Exercise)의 검증된 단일 진입 로직을
      // 그대로 타게 되어, 자체 nested navigate 로 인한 흰화면/중복 navigate 크래시를 피한다.
      const type = item.type;

      if (type === 'medication_reminder' || type === 'missed_medication') {
        // 약복용/미복용 → 약복용 자동선택 화면(OS 알림 탭과 동일)
        const mealTime = (data?.mealTime as string) ?? (data?.meal_time as string) ?? null;
        const doseSlotId =
          (data?.doseSlotId as string) ?? (data?.dose_slot_id as string) ?? null;
        try {
          await AsyncStorage.multiRemove(['pendingBodyStateNotif', 'pendingExerciseNotif']);
          await AsyncStorage.setItem(
            'pendingMedNotif',
            JSON.stringify({ mealTime, doseSlotId, ts: Date.now() }),
          );
        } catch (e) {
          console.warn('[NotificationHistory] pendingMedNotif 세팅 실패(무시):', e);
        }
        navigateTo('Main', {
          screen: 'Medication',
          params: { autoOpen: Date.now(), mealTime, doseSlotId },
        });
      } else if (type === 'effect_tracking') {
        // 몸상태(약효추적) → 약효 입력 화면. triggerMinutes 가 있으면 해당 시점 입력으로 진입.
        const triggerMinutes: number | null =
          typeof data?.minutes === 'number'
            ? data.minutes
            : typeof data?.triggerMinutes === 'number'
            ? data.triggerMinutes
            : null;
        const triggerMealTime =
          (data?.mealTime as string) ?? (data?.triggerMealTime as string) ?? null;
        const triggerDoseSlotId =
          (data?.doseSlotId as string) ?? (data?.dose_slot_id as string) ?? null;
        const triggerMedLogId =
          (data?.med_log_id as string) ?? (data?.medLogId as string) ?? null;
        try {
          await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingExerciseNotif']);
          if (triggerMinutes != null) {
            await AsyncStorage.setItem(
              'pendingBodyStateNotif',
              JSON.stringify({
                triggerMinutes,
                triggerMealTime,
                triggerDoseSlotId,
                triggerMedLogId,
                ts: Date.now(),
              }),
            );
          } else {
            await AsyncStorage.removeItem('pendingBodyStateNotif');
          }
        } catch (e) {
          console.warn('[NotificationHistory] pendingBodyStateNotif 세팅 실패(무시):', e);
        }
        navigateTo('Main', {
          screen: 'BodyStateTab',
          params: {
            screen: 'BodyState',
            // triggerMinutes 가 있을 때만 입력 트리거 params 전달 — 없으면 탭만 이동(중복 Alert 방지)
            params:
              triggerMinutes != null
                ? {
                    triggerMinutes,
                    triggerMealTime,
                    triggerDoseSlotId,
                    triggerMedLogId,
                    triggerTs: Date.now(),
                  }
                : undefined,
          },
        });
      } else if (type === 'exercise_reminder') {
        // 운동 → 운동 탭. ExerciseScreen.useFocusEffect 가 pendingExerciseNotif 를 단일 처리.
        try {
          await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingBodyStateNotif']);
          await AsyncStorage.setItem('pendingExerciseNotif', 'true');
        } catch (e) {
          console.warn('[NotificationHistory] pendingExerciseNotif 세팅 실패(무시):', e);
        }
        navigateTo('Main', { screen: 'Exercise', params: { screen: 'ExerciseMain' } });
      } else {
        // 알 수 없는 tappable 타입 — 안전 폴백: 지정 탭으로만 이동(잔존 키는 정리).
        try {
          await AsyncStorage.multiRemove([
            'pendingMedNotif',
            'pendingBodyStateNotif',
            'pendingExerciseNotif',
          ]);
        } catch {}
        navigateTo('Main', { screen: config.navigateTo });
      }
    } catch (e) {
      // 어떤 예외든 앱을 죽이지 않는다 — 조용히 무시(가드도 풀어 다음 탭 허용).
      navInFlightRef.current = false;
      console.error('[NotificationHistory] handleItemPress 예외(안전망 폴백):', e);
    }
  };

  // ── 리스트 아이템 ──────────────────────────
  const renderItem = ({ item }: { item: NotifLog }) => {
    const config = NOTIF_CONFIG[item.type] ?? DEFAULT_NOTIF_CONFIG;
    const isAlert =
      item.type === 'missed_medication' || item.type === 'caregiver_missed_med';
    const isUnread = !item.read_at;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleItemPress(item)}
      >
        <View style={[styles.itemRow, isAlert && styles.itemRowAlert]}>
          {/* 미읽음 빨간점 — 피드와 동일 패턴 */}
          <Text style={[styles.unreadDot, !isUnread && { opacity: 0 }]}>•</Text>

          {/* 아이콘 원 */}
          <View style={[styles.iconCircle, { backgroundColor: config.bgColor }]}>
            <Ionicons
              name={config.icon as any}
              size={26}
              color={config.iconColor}
            />
          </View>

          {/* 중앙: 제목 + 본문 */}
          <View style={styles.itemCenter}>
            {/* itemRow가 minHeight(고정 아님)라 줄바꿈돼도 그냥 늘어나면 됨 —
                제목/본문 다 줄 수 제한 없이 전체 노출(과거 알림 다시 읽는 화면이라 잘림 없이). */}
            <Text style={[styles.itemTitle, !isUnread && styles.itemTitleRead]}>
              {item.title}
            </Text>
            <Text style={styles.itemBody}>
              {item.body}
            </Text>
          </View>

          {/* 오른쪽: 시간 + chevron */}
          <View style={styles.itemRight}>
            <Text style={styles.itemTime}>{formatTime(item.created_at)}</Text>
            {config.tappable && (
              <Ionicons name="chevron-forward" size={20} color="#AAAAAA" />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ── 섹션 헤더 ─────────────────────────────
  const renderSectionHeader = ({ section }: { section: Section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  // ── "이전 알림 보기" 버튼 (리스트 하단) ──
  const renderFooter = () => {
    if (days >= 30) return null;
    return (
      <TouchableOpacity style={styles.moreButton} onPress={handleExpandDays} activeOpacity={0.7}>
        <Text style={styles.moreButtonText}>{t('notifHistory.viewOlder')}</Text>
      </TouchableOpacity>
    );
  };

  // ── 빈 상태 ──────────────────────────────
  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="notifications-off-outline" size={64} color="#CCCCCC" />
        <Text style={styles.emptyTitle}>{t('notifHistory.noNotifTitle')}</Text>
        <Text style={styles.emptyBody}>{t('notifHistory.noNotifBody', { days })}</Text>
      </View>
    );
  };

  // ── TopBar 우측 컴포넌트 (미읽음이 1개 이상일 때만 "전체 읽음" 표시) ──────────────────
  const hasUnread = sections.some((s) => s.data.some((d) => !d.read_at));
  const rightComponent = hasUnread ? (
    <TouchableOpacity
      onPress={handleMarkAllRead}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.markAllBtn}>{t('notifHistory.markAllRead')}</Text>
    </TouchableOpacity>
  ) : undefined;

  // ── 로딩 ─────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
        <TopBar title={t('notifHistory.headerTitle')} showBack rightComponent={rightComponent} />
        <SkeletonList count={6} visible={loading} style={styles.skeletonWrap} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TopBar title={t('notifHistory.headerTitle')} showBack rightComponent={rightComponent} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={sections.length > 0 ? renderFooter : null}
        contentContainerStyle={sections.length === 0 ? styles.emptyListContent : undefined}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skeletonWrap: { paddingHorizontal: 16, paddingTop: 16 },

  // 섹션 헤더
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666666',
  },

  // 리스트 아이템
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  itemRowAlert: {
    backgroundColor: '#FFEBEE',
  },
  unreadDot: {
    fontSize: 18,
    color: '#E53935',
    marginRight: 6,
    lineHeight: 26,
    alignSelf: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
  itemCenter: {
    flex: 1,
    marginRight: 8,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  itemTitleRead: {
    color: '#999999',
    fontWeight: '400',
  },
  itemBody: {
    fontSize: 16,
    color: '#666666',
    lineHeight: 22,
  },
  itemRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 0,
  },
  itemTime: {
    fontSize: 14,
    color: '#AAAAAA',
  },

  // 구분선
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 78,
  },

  // 이전 알림 보기 버튼
  moreButton: {
    marginHorizontal: 20,
    marginVertical: 24,
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreButtonText: {
    fontSize: 18,
    color: '#888888',
    fontWeight: '500',
  },

  // 전체 읽음 버튼
  markAllBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },

  // 빈 상태
  emptyListContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 24,
  },
});
